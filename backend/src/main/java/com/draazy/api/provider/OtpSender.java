package com.draazy.api.provider;

import com.draazy.api.security.LocalOnly;
import com.draazy.api.security.LocalProfileGuard;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

// Seam for outbound OTP delivery (ADR-007 provider strategy).
// The app must run and be demoable with zero paid keys, so the `dev` profile logs the code instead of sending it.
public interface OtpSender {

    String OPERATION = "otp";

    /** Deliver {@code code} to {@code mobile}. Implementations must not block the request thread long. */
    void send(String mobile, String code);

    default void send(String mobile, String code, Context context) {
        send(mobile, code);
    }

    record Context(String purpose, String text, List<String> templateParameters) {
    }

    // Delivery was attempted and did not demonstrably fail before leaving this process.
    class DeliveryFailedException extends RuntimeException {
        public DeliveryFailedException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}

// Dev only: log the OTP so testers can read it from the console — no external call, no key.
// Disabled when WhatsApp is enabled so Meta test-number credentials hit the real sender.
@Component
@LocalOnly
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class MockOtpSender implements OtpSender {

    private static final Logger log = LoggerFactory.getLogger(MockOtpSender.class);

    private final ProviderCalls calls;

    MockOtpSender(ProviderCalls calls) {
        this.calls = calls;
    }

    @Override
    public void send(String mobile, String code) {
        log.info("[MOCK OTP] mobile={} code={}", mobile, code);
        calls.record(ProviderCalls.WHATSAPP, OPERATION, ProviderCalls.Outcome.SKIPPED, mobile, null, "mock", null);
    }

    @Override
    public void send(String mobile, String code, Context context) {
        log.info("[MOCK OTP] mobile={} code={} text={}", mobile, code,
                context == null ? "" : context.text());
        calls.record(ProviderCalls.WHATSAPP, OPERATION, ProviderCalls.Outcome.SKIPPED, mobile, null, "mock", null);
    }
}

// Non-dev stub: fail loudly until WhatsApp credentials are supplied (ADR-020).
// Before turning the flag on, add a spend control.
@Component
@Profile(SandboxOtpSender.PROFILE + " & " + LocalProfileGuard.NOT_LOCAL)
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class SandboxOtpSender implements OtpSender {

    static final String PROFILE = LocalProfileGuard.SANDBOX_PROFILE;

    private static final Logger log = LoggerFactory.getLogger(SandboxOtpSender.class);

    private final ProviderCalls calls;

    SandboxOtpSender(ProviderCalls calls) {
        this.calls = calls;
    }

    @Override
    public void send(String mobile, String code) {
        log.warn("[SANDBOX OTP] mobile={} - not sent; the code is draazy.otp.sandbox-code", mobile);
        calls.record(ProviderCalls.WHATSAPP, OPERATION, ProviderCalls.Outcome.SKIPPED, mobile, null, "sandbox", null);
    }

    @Override
    public void send(String mobile, String code, Context context) {
        send(mobile, code);
    }
}

@Component
@Profile(LocalProfileGuard.NOT_LOCAL + " & !" + SandboxOtpSender.PROFILE)
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class UnconfiguredOtpSender implements OtpSender {

    @Override
    public void send(String mobile, String code) {
        throw new UnsupportedOperationException(
                "No OTP provider is configured. Set draazy.providers.whatsapp.enabled=true plus "
                        + "the WHATSAPP_* credentials (ADR-020), or run with the local profile.");
    }
}
