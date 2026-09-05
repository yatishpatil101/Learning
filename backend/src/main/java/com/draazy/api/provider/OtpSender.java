package com.draazy.api.provider;

import com.draazy.api.security.DevOnly;
import com.draazy.api.security.DevProfileGuard;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Seam for outbound OTP delivery (ADR-007 provider strategy). The app must run and be demoable with
 * zero paid keys, so the {@code dev} profile logs the code instead of sending it.
 *
 * <p>Which way round the two keyless implementations are selected is the security control, not a
 * detail (D147). The mock is opt-in under {@link DevOnly}; anything else — a named profile we do not
 * recognise, a typo, no profile at all — gets the stub that refuses to send, so a login that accepts
 * any six digits can only appear where someone asked for it by name.
 *
 * <p><strong>The real sender sits outside that axis.</strong>
 * {@link com.draazy.api.provider.whatsapp.WhatsAppOtpSender} is selected by
 * {@code draazy.providers.whatsapp.enabled} alone, and both beans below step aside for it:
 *
 * <table>
 *   <caption>Bean selected by (profile × flag)</caption>
 *   <tr><th></th><th>flag off / absent</th><th>flag {@code true}</th><th>flag anything else</th></tr>
 *   <tr><td>{@code dev}</td><td>{@code MockOtpSender} — logs the code</td><td>WhatsApp</td>
 *       <td>none — boot fails</td></tr>
 *   <tr><td>anything else</td><td>{@code UnconfiguredOtpSender} — throws</td><td>WhatsApp</td>
 *       <td>none — boot fails</td></tr>
 * </table>
 *
 * <p>That third column is not an oversight. {@code @ConditionalOnProperty} compares the raw string,
 * so {@code yes}, {@code on}, {@code 1} — and, the realistic one, a variable exported empty, since
 * {@code ${WHATSAPP_ENABLED:false}} defaults only when <em>unset</em> — match neither condition and
 * leave no bean for {@code OtpService} to inject. It fails closed, loudly, at startup. The one
 * outcome that cannot be reached from a bad value is the dangerous one: the flag can only ever
 * <em>remove</em> the mock, never select it, because {@link DevOnly} still demands the literal
 * {@code dev} profile and {@code DRAAZY_DEV_MACHINE} in the environment. D147 holds.
 *
 * <p>The flag has to win over the profile rather than the other way round because Meta publishes no
 * sandbox host: its test number is a real number on the live API, so "exercise the real sender" and
 * "be a developer's machine" are not mutually exclusive states, and a profile-only split could not
 * express the combination.
 */
public interface OtpSender {

    /** Deliver {@code code} to {@code mobile}. Implementations must not block the request thread long. */
    void send(String mobile, String code);

    /**
     * Delivery was attempted and did not demonstrably fail before leaving this process.
     *
     * <p><strong>Throwing this is a claim, and it costs the caller something.</strong>
     * {@code OtpService} names this type in {@code noRollbackFor}, so the {@code otp_codes} row it
     * just wrote survives the throw — and because the send budget is derived from those rows rather
     * than from a counter, the attempt <em>spends a slot</em>. That is deliberate: a vendor call that
     * times out after the message was accepted is indistinguishable from one that was refused, and
     * between over-charging a slot and handing out a free "ring this number" the only safe direction
     * is over-charging.
     *
     * <p><strong>Do not throw it for a failure that provably sent nothing.</strong> A missing
     * credential, an unwired provider, a bug in the implementation — none of those reached a
     * network, so charging the recipient's budget for them buys no safety and costs a self-inflicted
     * lockout: five attempts against a misconfigured deployment 429 that number for an hour, and the
     * lockout outlives the repair because the rows are already committed. Let those propagate as
     * whatever they are; they roll back, as they should. {@code UnconfiguredOtpSender} throws
     * {@link UnsupportedOperationException} for exactly this reason.
     *
     * <p>Declared on the seam rather than in {@code OtpService} so the two sides share one
     * vocabulary. The alternative — {@code OtpService} catching {@code RuntimeException} and
     * relabelling it — would sweep up the cases above, and worse: a {@code DataAccessException} or a
     * {@code TransactionException} relabelled as a delivery failure would make {@code noRollbackFor}
     * attempt a commit on an already-aborted transaction, losing the row anyway and reporting the
     * loss under a name that hides it.
     */
    class DeliveryFailedException extends RuntimeException {
        public DeliveryFailedException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}

/**
 * Dev only: log the OTP so testers can read it from the console — no external call, no key.
 *
 * <p>Steps aside when {@code draazy.providers.whatsapp.enabled=true}, so a developer holding Meta
 * test-number credentials exercises the real sender instead. This is the same precedence
 * {@code MockFileStorage} gives {@code R2FileStorage}, and it matters more here: the automated suite
 * cannot use WhatsApp at all (a test number may only message five pre-verified recipients), so the
 * only way anyone ever sees a real message is a human turning this flag on locally.
 */
@Component
@DevOnly
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class MockOtpSender implements OtpSender {

    private static final Logger log = LoggerFactory.getLogger(MockOtpSender.class);

    @Override
    public void send(String mobile, String code) {
        log.info("[MOCK OTP] mobile={} code={}", mobile, code);
    }
}

/**
 * Non-dev stub: fail loudly until WhatsApp credentials are supplied (ADR-020).
 *
 * <p><strong>Before turning the flag on, add a spend control.</strong> {@code OtpService} rate-limits
 * per <em>recipient</em>, which stops a chosen victim being bombed and caps the spend attributable to
 * any one number — but nothing stops an attacker walking through thousands of valid-looking numbers to
 * run up the bill, because each fresh number starts with a fresh budget. That gap is harmless while
 * this method sends nothing and becomes live the moment it does. On WhatsApp it costs more than money:
 * messages to numbers with no WhatsApp account, and to strangers who report them, drag the sending
 * number's <em>quality rating</em> down, and a low rating cuts the daily messaging limit. The failure
 * mode is therefore not only a bill but an outage of sign-in itself, arriving days later and not
 * obviously connected to the attack.
 *
 * <p>The fix belongs at the edge, not here: a spend cap on the Meta billing account plus per-IP
 * throttling at the load balancer or WAF. Doing IP throttling in-process would need a trusted-proxy
 * config the deployment does not yet have — get it wrong and you either throttle every user behind the
 * balancer as one IP, or throttle a header the client can forge. An in-app limiter that can be spoofed
 * is worse than none, because it reads as protection.
 *
 * <p>Bound to "not dev" rather than to {@code prod} so that a staging or preview environment gets an
 * {@code OtpSender} at all: bound to {@code prod}, an unrecognised profile would leave the bean
 * missing and the app would fail to start for a reason that reads as a wiring bug.
 */
@Component
@Profile(DevProfileGuard.NOT_DEV)
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled",
        havingValue = "false", matchIfMissing = true)
class UnconfiguredOtpSender implements OtpSender {

    @Override
    public void send(String mobile, String code) {
        throw new UnsupportedOperationException(
                "No OTP provider is configured. Set draazy.providers.whatsapp.enabled=true plus "
                        + "the WHATSAPP_* credentials (ADR-020), or run with the dev profile.");
    }
}
