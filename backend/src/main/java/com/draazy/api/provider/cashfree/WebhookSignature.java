package com.draazy.api.provider.cashfree;

import com.draazy.api.security.LocalProfileGuard;
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
 * Verifies the HMAC-SHA256 signature Cashfree puts on every webhook — the only thing between "this
 * order was paid" and a self-granted plan. Rules: docs/flows/consumer/plans-billing-refer.md.
 */
@Component
public class WebhookSignature {

    private static final String HMAC_SHA256 = "HmacSHA256";

    /** The value in {@code application.properties}, and therefore public. Never usable live. */
    private static final String COMMITTED_DEFAULT = "dev-webhook-secret";

    /**
     * How far the signed timestamp may be from now. The signature proves authenticity, not
     * freshness: without a window, a payload captured once is replayable forever.
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
                                + "repository can sign a payment callback for any order");
            }
        }
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * Why this instance would be verifying callbacks that matter, or {@code null} if it would not.
     * A reason rather than a boolean, so the boot failure names which trigger fired.
     */
    private static String liveDeploymentReason(boolean gatewayEnabled, Environment environment) {
        if (gatewayEnabled) {
            return "draazy.providers.cashfree.enabled=true";
        }
        if (!environment.acceptsProfiles(Profiles.of(LocalProfileGuard.LOCAL_PROFILE))) {
            return "the '" + LocalProfileGuard.LOCAL_PROFILE + "' profile is not active";
        }
        return null;
    }

    /**
     * True only for a well-formed, matching, <em>recent</em> signature. Every other outcome is
     * simply "not verified": the caller drops the payload and still answers 200.
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
     * The raw HMAC over {@code timestamp + rawBody}. Shared by {@link #matches} and {@link #sign} so
     * the two cannot drift: a verifier and signer that disagree still agree in every test.
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
     * The signature a caller <em>should</em> send. Exists so tests exercise the real verification
     * path: a signature check that is only ever mocked is a signature check nobody has run.
     */
    public String sign(String timestamp, String rawBody) {
        try {
            return Base64.getEncoder().encodeToString(hmac(timestamp, rawBody));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }
}
