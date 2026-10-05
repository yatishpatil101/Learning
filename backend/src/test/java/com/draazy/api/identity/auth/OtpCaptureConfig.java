package com.draazy.api.identity.auth;

import com.draazy.api.provider.OtpSender;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.transaction.annotation.Transactional;

/** Imported by every class that needs to read the last code sent or to fail a send on demand. */
@TestConfiguration
class OtpCaptureConfig {

    @Bean
    @Primary
    CapturingOtpSender capturingOtpSender() {
        return new CapturingOtpSender();
    }

    @Bean
    OuterTransaction outerTransaction(OtpService otpService) {
        return new OuterTransaction(otpService);
    }

    static class CapturingOtpSender implements OtpSender {
        volatile String lastCode;
        /** Makes the next send fail the way a real provider does when the vendor call fails. */
        volatile boolean failNext;

        @Override
        public void send(String mobile, String code) {
            this.lastCode = code;
            if (failNext) {
                failNext = false;
                throw new DeliveryFailedException("simulated provider failure", null);
            }
        }
    }

    /** Stands in for the real callers that own a transaction around the OTP seam. */
    static class OuterTransaction {
        private final OtpService otpService;

        OuterTransaction(OtpService otpService) {
            this.otpService = otpService;
        }

        @Transactional(noRollbackFor = OtpSender.DeliveryFailedException.class)
        public void sendInsideItsOwnTransaction(String mobile) {
            otpService.sendLoginCode(mobile);
        }
    }
}
