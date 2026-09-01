package com.draazy.api.provider.cashfree;

import com.draazy.api.security.DevProfileGuard;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.stereotype.Component;

/**
 * Verifies the HMAC-SHA256 signature Cashfree puts on every webhook — the only thing standing between
 * "DigiLocker verified this person" and "anyone on the internet can grant themselves a badge".
 *
 * <p><strong>Signed material is {@code x-webhook-timestamp + rawBody}</strong>, in that order, with no
 * separator. The timestamp is inside the signature so a captured payload cannot be re-signed under a
 * different time, and the body must be the <em>raw</em> bytes we received: parsing and re-serializing
 * JSON reorders keys and normalises whitespace, which changes the digest and would make every genuine
 * callback look forged.
 *
 * <p>Comparison is {@link MessageDigest#isEqual} rather than {@code String.equals} — constant-time, so
 * an attacker cannot recover a valid signature byte by byte from response timing.
 *
 * <p>The secret is environment-supplied. The committed default exists only so the mock KYC flow is
 * demoable with zero vendor keys, and this class refuses to start on it in either of the two
 * situations where it would be live rather than decorative (D155):
 *
 * <ul>
 *   <li><strong>The live gateway is switched on</strong>
 *       ({@code draazy.providers.cashfree.enabled=true}), under any profile. Real money on a
 *       published key is the same mistake whether or not the profile happens to be called prod, and
 *       a staging box taking real payments on {@value #COMMITTED_DEFAULT} would accept a callback
 *       anyone reading this repository could forge.</li>
 *   <li><strong>The {@code prod} profile is active</strong>, gateway flag or not. Without this the
 *       guard read as covering production and did not: a production deploy that had not yet turned
 *       the payment rail on would boot happily on the public secret, and the DigiLocker webhook it
 *       still serves is exactly the "anyone can grant themselves a badge" path above.</li>
 * </ul>
 *
 * <p>{@code application-prod.properties} separately binds a bare {@code ${CASHFREE_WEBHOOK_SECRET}},
 * so a prod boot with the variable unset fails in the binder before reaching this constructor. That
 * is a second mechanism in a different file, and it only fires for a deploy that both names the
 * {@code prod} profile and reads that file; the check here is what states the rule.
 *
 * <p>A <em>blank</em> secret is rejected outright at construction: an empty HMAC key still produces
 * a perfectly valid, publicly-computable signature, so {@code CASHFREE_WEBHOOK_SECRET=""} would
 * silently turn verification into a formality rather than failing loudly.
 */
@Component
public class WebhookSignature {

    private static final String HMAC_SHA256 = "HmacSHA256";

    /** The value in {@code application.properties}, and therefore public. Never usable live. */
    private static final String COMMITTED_DEFAULT = "dev-webhook-secret";

    /**
     * How far the signed timestamp may be from now. The signature alone proves authenticity, not
     * freshness — without a window, a payload captured once is replayable forever. Five minutes is the
     * usual provider allowance for retries and clock skew.
     */
    private static final long MAX_SKEW_MILLIS = 5 * 60 * 1000L;

    private final byte[] secret;

    public WebhookSignature(
            @Value("${draazy.webhooks.cashfree.secret}") String secret,
            @Value("${draazy.providers.cashfree.enabled:false}") boolean gatewayEnabled,
            Environment environment) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "draazy.webhooks.cashfree.secret must be set (CASHFREE_WEBHOOK_SECRET); "
                            + "a blank webhook key makes every forged signature valid");
        }
        if (COMMITTED_DEFAULT.equals(secret)) {
            String live = liveDeploymentReason(gatewayEnabled, environment);
            if (live != null) {
                throw new IllegalStateException(
                        live + " but the webhook secret is still the committed default; set "
                                + "CASHFREE_WEBHOOK_SECRET to the real key, because anyone with this "
                                + "repository can sign a payment callback or a DigiLocker 'verified' "
                                + "result for any account");
            }
        }
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * Why this instance would be verifying callbacks that matter, or {@code null} if it would not.
     * Returned as the reason rather than a boolean so the boot failure names the trigger — the two
     * are independent, and a deploy that hits the second one will not find the first anywhere in its
     * configuration to explain the message.
     *
     * <p>The second arm is an <strong>allowlist</strong>, not a check for {@code prod} (D147/D155).
     * It used to ask whether the {@code prod} profile was active, which meant a container named
     * {@code staging}, {@code production}, {@code preview}, or nothing at all — the ordinary state of
     * a first deploy, before the payment rail is switched on — booted happily on a secret that is in
     * the repository. Both webhook routes are {@code permitAll} and exempt from the write rate
     * limiter, so anyone holding this repository could then sign a DigiLocker "verified" result for
     * their own account, or a {@code PAYMENT_SUCCESS} for an order id the API had just handed them,
     * and take the Verified badge or a paid subscription for nothing.
     *
     * <p>Note both arms still apply under {@code dev}: a developer pointing at the Cashfree sandbox
     * turns the gateway flag on and must supply the sandbox key, because that instance receives
     * callbacks from outside this machine.
     */
    private static String liveDeploymentReason(boolean gatewayEnabled, Environment environment) {
        if (gatewayEnabled) {
            return "draazy.providers.cashfree.enabled=true";
        }
        if (!environment.acceptsProfiles(Profiles.of(DevProfileGuard.DEV_PROFILE))) {
            return "the '" + DevProfileGuard.DEV_PROFILE + "' profile is not active";
        }
        return null;
    }

    /**
     * @param signature the {@code x-webhook-signature} header (base64), or {@code null} if absent
     * @param timestamp the {@code x-webhook-timestamp} header (epoch millis), or {@code null} if absent
     * @param rawBody   the exact request body bytes, as received
     * @return {@code true} only for a well-formed, matching, <em>recent</em> signature; a missing
     *         header, an unparsable value, a stale timestamp or a crypto failure are all simply "not
     *         verified" — the caller then drops the payload and still answers {@code 200}, telling a
     *         prober nothing
     */
    public boolean matches(String signature, String timestamp, String rawBody) {
        if (signature == null || timestamp == null || rawBody == null || !isFresh(timestamp)) {
            return false;
        }
        try {
            byte[] expected = hmac(timestamp, rawBody);
            return MessageDigest.isEqual(expected, Base64.getDecoder().decode(signature));
        } catch (Exception cannotVerify) {
            return false;
        }
    }

    /**
     * The raw HMAC over the signed material — {@code timestamp + rawBody}, in that order.
     *
     * <p>Shared by {@link #matches} and {@link #sign} so the two can never drift: a verifier and a
     * signer that compute the material differently agree in every test and disagree in production.
     */
    private byte[] hmac(String timestamp, String rawBody) throws GeneralSecurityException {
        Mac mac = Mac.getInstance(HMAC_SHA256);
        mac.init(new SecretKeySpec(secret, HMAC_SHA256));
        return mac.doFinal((timestamp + rawBody).getBytes(StandardCharsets.UTF_8));
    }

    /** Within {@link #MAX_SKEW_MILLIS} of now, in either direction. Unparsable is not fresh. */
    private boolean isFresh(String timestamp) {
        try {
            return Math.abs(System.currentTimeMillis() - Long.parseLong(timestamp.trim()))
                    <= MAX_SKEW_MILLIS;
        } catch (NumberFormatException notATimestamp) {
            return false;
        }
    }

    /**
     * The signature a caller <em>should</em> send for this timestamp and body. Exists so tests can
     * exercise the real verification path instead of stubbing it out — a signature check that is only
     * ever mocked is a signature check nobody has run.
     */
    public String sign(String timestamp, String rawBody) {
        try {
            return Base64.getEncoder().encodeToString(hmac(timestamp, rawBody));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }
}
