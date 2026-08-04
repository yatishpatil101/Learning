package com.punenest.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.provider.OtpSender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Guards that the per-code OTP attempt cap is <em>durable across transactions</em> — the failure mode
 * that only bites in prod, where each verify is a separate request/tx. Deliberately <strong>not</strong>
 * {@code @Transactional}: wrapping every call in one rolled-back tx would mask exactly the bug this
 * guards (a wrong-guess attempt increment being rolled back together with the thrown 401, so the cap
 * never accumulates). The {@code noRollbackFor} on {@code verifyLoginCode} is what makes this pass.
 *
 * <p>Being non-transactional means nothing rolls the written rows back, and {@code sendLoginCode}
 * rate-limits on exactly those rows — {@code MAX_SENDS_PER_WINDOW} per mobile per rolling hour. Left
 * alone the test therefore poisons itself: the fifth {@code mvn verify} inside an hour fails at the
 * <em>first</em> line with a 429, a failure that says nothing about the cap it is guarding. So it
 * clears its own number first rather than assuming a fresh database, and again afterwards so it
 * leaves none behind. The number is test-only and matched by no other test.
 */
@SpringBootTest
class OtpServiceDurabilityTest {

    private static final String MOBILE = "9876500911";

    @Autowired
    OtpService otpService;
    @Autowired
    CapturingOtpSender otp;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    @AfterEach
    void clearOwnSendHistory() {
        jdbc.update("delete from otp_codes where mobile = ?", MOBILE);
    }

    @Test
    void failedAttemptsAccumulateAcrossTransactionsUntilTheCapTrips() {
        otpService.sendLoginCode(MOBILE);
        // A code guaranteed to differ from the real one, so every verify takes the wrong-guess path.
        String wrong = "000000".equals(otp.lastCode) ? "111111" : "000000";

        for (int i = 0; i < OtpService.MAX_ATTEMPTS; i++) {
            assertThatThrownBy(() -> otpService.verifyLoginCode(MOBILE, wrong))
                    .isInstanceOf(UnauthorizedException.class);
        }
        // Once the cap is reached the code is burned and further tries are rate-limited (429).
        assertThatThrownBy(() -> otpService.verifyLoginCode(MOBILE, wrong))
                .isInstanceOf(RateLimitedException.class);
    }

    static class CapturingOtpSender implements OtpSender {
        volatile String lastCode;

        @Override
        public void send(String mobile, String code) {
            this.lastCode = code;
        }
    }

    @TestConfiguration
    static class Config {
        @Bean
        @Primary
        CapturingOtpSender capturingOtpSender() {
            return new CapturingOtpSender();
        }
    }
}
