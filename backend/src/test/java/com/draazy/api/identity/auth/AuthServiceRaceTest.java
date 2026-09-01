package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.draazy.api.common.access.StaffAccountApprovalRepository;
import com.draazy.api.identity.user.SelfProfile;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserMapperImpl;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserService;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.JwtService;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * Proves the first-sign-in insert race is absorbed: if a concurrent request wins the {@code
 * UNIQUE(mobile)} insert (surfaced as {@link DataIntegrityViolationException} from the {@code
 * REQUIRES_NEW} provisioning tx), {@code login} adopts the winner's row and still issues tokens rather
 * than surfacing a 500. Pure Mockito — no Spring context — so the branch is exercised deterministically
 * without needing real thread interleaving.
 */
class AuthServiceRaceTest {

    @Test
    void concurrentFirstSignInAdoptsTheWinnerRowInsteadOf500() {
        UserRepository users = mock(UserRepository.class);
        UserService userService = mock(UserService.class);
        OtpService otpService = mock(OtpService.class);
        JwtService jwtService = mock(JwtService.class);
        RefreshTokenService refreshTokens = mock(RefreshTokenService.class);
        PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
        // Real generated mapper (not a mock): the mapping is mechanical and we want the assertions
        // below to exercise the true entity→wire projection, not a stubbed shortcut. Wrapped in a
        // real SelfProfile for the same reason — it is what decides whether the session's user
        // carries back-office permission atoms, and a buyer must come back without them.
        SelfProfile selfProfile = new SelfProfile(new UserMapperImpl(), mock(AccountPermissions.class));

        String mobile = "9876500900";
        // No existing row when we look ⇒ provisioning path; the concurrent winner then beats our insert.
        when(users.findByMobile(mobile)).thenReturn(Optional.empty());
        when(userService.provisionBuyer(mobile))
                .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"));
        User winner = new User(mobile, "buyer");
        winner.setMobileVerified(true);
        ReflectionTestUtils.setField(winner, "id", UUID.randomUUID());
        when(users.findByMobileAndArchivedFalse(mobile)).thenReturn(Optional.of(winner));
        when(jwtService.issueAccessToken(winner)).thenReturn("access-token");
        when(jwtService.accessTtl()).thenReturn(Duration.ofMinutes(15));
        when(refreshTokens.issue(any())).thenReturn("refresh-token");

        // Buyer login never consults the staff-approval gate (V67) nor the activation gate (V71, a
        // back-office concern), so unstubbed mocks are the honest stand-in: if this path ever starts
        // reading either, the mock returns false and the assertions below would have to change to
        // say so.
        AuthService service = new AuthService(
                users, userService, selfProfile, otpService, jwtService, refreshTokens, passwordEncoder,
                mock(StaffAccountApprovalRepository.class), mock(StaffInviteRepository.class));

        AuthResponse response = service.login(new LoginRequest(mobile, "123456", null, null));

        assertThat(response.accessToken()).isEqualTo("access-token");
        assertThat(response.user().mobile()).isEqualTo(mobile);
        assertThat(response.user().role()).isEqualTo("buyer");
        // A consumer session says nothing about back-office access — the key is absent, not empty.
        assertThat(response.user().permissions()).isNull();
    }

    @Test
    void staffLoginUnknownEmailStillRunsPasswordMatchBefore401() {
        UserRepository users = mock(UserRepository.class);
        UserService userService = mock(UserService.class);
        OtpService otpService = mock(OtpService.class);
        JwtService jwtService = mock(JwtService.class);
        RefreshTokenService refreshTokens = mock(RefreshTokenService.class);
        PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);
        SelfProfile selfProfile = new SelfProfile(new UserMapperImpl(), mock(AccountPermissions.class));

        when(users.findByEmailIgnoreCaseAndArchivedFalse("missing@draazy.in")).thenReturn(Optional.empty());
        String dummyHash = (String) ReflectionTestUtils
                .getField(AuthService.class, "STAFF_LOGIN_DUMMY_BCRYPT");
        when(passwordEncoder.matches("any-pass", dummyHash)).thenReturn(false);

        // The approval and activation gates are only reached once a staff row is found; the lookup
        // above is empty, so these mocks must stay unstubbed. Stubbing either would hide a
        // regression that moved a gate ahead of the dummy-hash compare and reopened the
        // account-enumeration timing leak this test exists to pin.
        AuthService service = new AuthService(
                users, userService, selfProfile, otpService, jwtService, refreshTokens, passwordEncoder,
                mock(StaffAccountApprovalRepository.class), mock(StaffInviteRepository.class));

        assertThatThrownBy(() -> service.staffLogin(new StaffLoginRequest("missing@draazy.in", "any-pass", null)))
                .isInstanceOf(com.draazy.api.common.error.UnauthorizedException.class);

                verify(passwordEncoder, times(1)).matches("any-pass", dummyHash);
    }
}
