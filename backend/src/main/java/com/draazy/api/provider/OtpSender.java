package com.draazy.api.provider;

import com.draazy.api.security.DevOnly;
import com.draazy.api.security.DevProfileGuard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Seam for outbound OTP delivery (ADR-007 provider strategy). The app must run and be demoable with
 * zero paid keys, so the {@code dev} profile logs the code instead of sending it.
 *
 * <p>Which way round the two implementations are selected is the security control, not a detail
 * (D147). The mock is opt-in under {@link DevOnly}; anything else — a named profile we do not
 * recognise, a typo, no profile at all — gets the real sender, so a login that accepts any six
 * digits can only appear where someone asked for it by name.
 */
public interface OtpSender {

    /** Deliver {@code code} to {@code mobile}. Implementations must not block the request thread long. */
    void send(String mobile, String code);
}

/** Dev only: log the OTP so testers can read it from the console — no external call, no key. */
@Component
@DevOnly
class MockOtpSender implements OtpSender {

    private static final Logger log = LoggerFactory.getLogger(MockOtpSender.class);

    @Override
    public void send(String mobile, String code) {
        log.info("[MOCK OTP] mobile={} code={}", mobile, code);
    }
}

/**
 * Prod stub: fail loudly until a real SMS provider (e.g. via Cashfree/MSG91) is wired in.
 *
 * <p><strong>Before wiring a gateway here, add a spend control.</strong> {@code OtpService} rate-limits
 * per <em>recipient</em>, which stops a chosen victim being bombed and caps the spend attributable to
 * any one number — but nothing stops an attacker walking through thousands of valid-looking numbers to
 * run up the bill, because each fresh number starts with a fresh budget. That gap is harmless today
 * (this method sends nothing) and becomes a live financial DoS the moment it does.
 *
 * <p>The fix belongs at the edge, not here: a spend cap on the gateway account plus per-IP throttling
 * at the load balancer or WAF. Doing IP throttling in-process would need a trusted-proxy config the
 * deployment does not yet have — get it wrong and you either throttle every user behind the balancer
 * as one IP, or throttle a header the client can forge. An in-app limiter that can be spoofed is worse
 * than none, because it reads as protection.
 *
 * <p>Bound to "not dev" rather than to {@code prod} so that a staging or preview environment gets an
 * {@code OtpSender} at all: bound to {@code prod}, an unrecognised profile would leave the bean
 * missing and the app would fail to start for a reason that reads as a wiring bug.
 */
@Component
@Profile(DevProfileGuard.NOT_DEV)
class SmsOtpSender implements OtpSender {

    @Override
    public void send(String mobile, String code) {
        throw new UnsupportedOperationException("SMS OTP provider not configured for prod yet");
    }
}
