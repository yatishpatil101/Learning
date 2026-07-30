package com.punenest.api.provider;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Seam for outbound OTP delivery (ADR-007 provider strategy). The app must run and be demoable with
 * zero paid keys, so the dev/default impl just logs the code; a real SMS gateway is wired only under
 * the {@code prod} profile.
 */
public interface OtpSender {

    /** Deliver {@code code} to {@code mobile}. Implementations must not block the request thread long. */
    void send(String mobile, String code);
}

/** Dev/default: log the OTP so testers can read it from the console — no external call, no key. */
@Component
@Profile("!prod")
class MockOtpSender implements OtpSender {

    private static final Logger log = LoggerFactory.getLogger(MockOtpSender.class);

    @Override
    public void send(String mobile, String code) {
        log.info("[MOCK OTP] mobile={} code={}", mobile, code);
    }
}

/** Prod stub: fail loudly until a real SMS provider (e.g. via Cashfree/MSG91) is wired in. */
@Component
@Profile("prod")
class SmsOtpSender implements OtpSender {

    @Override
    public void send(String mobile, String code) {
        throw new UnsupportedOperationException("SMS OTP provider not configured for prod yet");
    }
}
