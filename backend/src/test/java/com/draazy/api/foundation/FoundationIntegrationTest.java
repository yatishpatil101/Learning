package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.identity.auth.RefreshTokenService;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.JwtService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/**
 * JWT issue/parse, refresh rotation with reuse-detection, and every external seam resolving to a
 * keyless mock in dev. {@code @Transactional} so the fixture user rolls back.
 */
@SpringBootTest
@Transactional
class FoundationIntegrationTest {

    @Autowired
    JwtService jwtService;
    @Autowired
    RefreshTokenService refreshTokenService;
    @Autowired
    UserRepository userRepository;
    @Autowired
    OtpSender otpSender;
    @Autowired
    FileStorage fileStorage;
    @Autowired
    PaymentGateway paymentGateway;

    private User persistStaff() {
        User u = new User("9876500011", "staff");
        u.setTeam("legal");
        u.setMobileVerified(true);
        return userRepository.saveAndFlush(u);
    }

    @Test
    void accessTokenRoundTripsAllClaims() {
        User user = persistStaff();

        String token = jwtService.issueAccessToken(user);
        AuthPrincipal principal = jwtService.parse(token);

        assertThat(principal.userId()).isEqualTo(user.getId());
        assertThat(principal.role()).isEqualTo("staff");
        assertThat(principal.team()).isEqualTo("legal");
        assertThat(principal.mobileVerified()).isTrue();
        assertThat(principal.verified()).isFalse();
    }

    /**
     * Strict because the test properties shut the production grace window;
     * {@code RefreshGraceWindowTest} is the only class that opens it.
     */
    @Test
    void refreshRotationIssuesNewTokenThenDetectsReuse() {
        UUID userId = persistStaff().getId();

        String first = refreshTokenService.issue(userId);
        var rotation = refreshTokenService.rotate(first);

        assertThat(rotation.userId()).isEqualTo(userId);
        assertThat(rotation.refreshToken()).isNotEqualTo(first);

        // Replaying the rotated token is treated as theft — rejected, and the family burned so
        // even the freshly-issued token is dead.
        assertThatThrownBy(() -> refreshTokenService.rotate(first))
                .isInstanceOf(UnauthorizedException.class);
        assertThatThrownBy(() -> refreshTokenService.rotate(rotation.refreshToken()))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void everyProviderSeamResolvesToAKeylessMock() {
        // None of these touch the network or need a paid key.
        otpSender.send("9876500011", "123456");
        assertThat(fileStorage.signedDownloadUrl("docs/a.pdf")).contains("docs/a.pdf");
        assertThat(paymentGateway.createOrder(2500, "ref-1").orderId()).isNotBlank();
    }
}
