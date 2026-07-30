package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.identity.auth.RefreshTokenService;
import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.provider.FileStorage;
import com.punenest.api.provider.KycProvider;
import com.punenest.api.provider.OtpSender;
import com.punenest.api.provider.PaymentGateway;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.JwtService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/**
 * Proves the cross-cutting pieces that need the real Spring context + live schema: JWT
 * issue/parse, refresh rotation with reuse-detection, and that every external seam resolves to a
 * keyless mock in dev. Runs {@code @Transactional} so its fixture user rolls back (keeps the unique
 * mobile constraint clean across reruns).
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
    @Autowired
    KycProvider kycProvider;

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
        assertThat(principal.aadhaarVerified()).isFalse();
    }

    @Test
    void refreshRotationIssuesNewTokenThenDetectsReuse() {
        UUID userId = persistStaff().getId();

        String first = refreshTokenService.issue(userId);
        var rotation = refreshTokenService.rotate(first);

        assertThat(rotation.userId()).isEqualTo(userId);
        assertThat(rotation.refreshToken()).isNotEqualTo(first);

        // Replaying the already-rotated token is treated as theft: rejected...
        assertThatThrownBy(() -> refreshTokenService.rotate(first))
                .isInstanceOf(UnauthorizedException.class);
        // ...and the whole family is burned, so even the freshly-issued token is now dead.
        assertThatThrownBy(() -> refreshTokenService.rotate(rotation.refreshToken()))
                .isInstanceOf(UnauthorizedException.class);
    }

    @Test
    void everyProviderSeamResolvesToAKeylessMock() {
        // None of these touch the network or need a paid key.
        otpSender.send("9876500011", "123456");
        assertThat(fileStorage.signedDownloadUrl("docs/a.pdf")).contains("docs/a.pdf");
        assertThat(paymentGateway.createOrder(2500, "ref-1").orderId()).isNotBlank();
        assertThat(kycProvider.start("user-1").verificationUrl()).isNotBlank();
    }
}
