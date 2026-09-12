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
import com.draazy.api.common.settings.PlatformSettings;
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
 * Absorbs the first-sign-in {@code UNIQUE(mobile)} race: the loser adopts the winner's row instead
 * of surfacing a 500. Pure Mockito, so the branch runs without real thread interleaving.
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
        // Real mapper and SelfProfile, not mocks: what decides whether a buyer session carries
        // back-office permission atoms is the thing under assertion below.
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

        // The staff gates must stay unstubbed — buyer login never reads them, and stubbing would
        // hide a regression. Signups must be stubbed open or a mock's default false refuses first.
        PlatformSettings platformSettings = mock(PlatformSettings.class);
        when(platformSettings.signupsEnabled()).thenReturn(true);
        AuthService service = new AuthService(
                users, userService, selfProfile, otpService, jwtService, refreshTokens, passwordEncoder,
                mock(StaffAccountApprovalRepository.class), mock(StaffInviteRepository.class),
                platformSettings);

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

        // These mocks stay unstubbed deliberately: stubbing one would hide a regression that moved a
        // gate ahead of the dummy-hash compare and reopened the enumeration timing leak.
        AuthService service = new AuthService(
                users, userService, selfProfile, otpService, jwtService, refreshTokens, passwordEncoder,
                mock(StaffAccountApprovalRepository.class), mock(StaffInviteRepository.class),
                mock(PlatformSettings.class));

        assertThatThrownBy(() -> service.staffLogin(new StaffLoginRequest("missing@draazy.in", "any-pass", null)))
                .isInstanceOf(com.draazy.api.common.error.UnauthorizedException.class);

                verify(passwordEncoder, times(1)).matches("any-pass", dummyHash);
    }
}
