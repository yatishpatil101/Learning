package com.punenest.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.provider.OtpSender;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * Guards that the per-code OTP attempt cap is <em>durable across transactions</em> — the failure mode
 * that only bites in prod, where each verify is a separate request/tx. Deliberately <strong>not</strong>
 * {@code @Transactional}: wrapping every call in one rolled-back tx would mask exactly the bug this
 * guards (a wrong-guess attempt increment being rolled back together with the thrown 401, so the cap
 * never accumulates). The {@code noRollbackFor} on {@code verifyLoginCode} is what makes this pass.
 */
@SpringBootTest
class OtpServiceDurabilityTest {

    @Autowired
    OtpService otpService;
    @Autowired
    CapturingOtpSender otp;

    @Test
    void failedAttemptsAccumulateAcrossTransactionsUntilTheCapTrips() {
        String mobile = "9876500911";
        otpService.sendLoginCode(mobile);
        // A code guaranteed to differ from the real one, so every verify takes the wrong-guess path.
        String wrong = "000000".equals(otp.lastCode) ? "111111" : "000000";

        for (int i = 0; i < OtpService.MAX_ATTEMPTS; i++) {
            assertThatThrownBy(() -> otpService.verifyLoginCode(mobile, wrong))
                    .isInstanceOf(UnauthorizedException.class);
        }
        // Once the cap is reached the code is burned and further tries are rate-limited (429).
        assertThatThrownBy(() -> otpService.verifyLoginCode(mobile, wrong))
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
