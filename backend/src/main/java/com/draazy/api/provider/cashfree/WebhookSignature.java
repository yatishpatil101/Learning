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

/** The only thing between "this order was paid" and a self-granted plan. */
@Component
public class WebhookSignature {

    private static final String HMAC_SHA256 = "HmacSHA256";

    /** The value in {@code application.properties}, and therefore public. Never usable live. */
    private static final String COMMITTED_DEFAULT = "dev-webhook-secret";

    /** The signature proves authenticity, not freshness: unbounded, one capture replays forever. */
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

    /** A reason rather than a boolean, so the boot failure names which trigger fired. */
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
     * Four refusals, because one undifferentiated "signature did not verify" line named the secret
     * as the suspect when the secret was correct.
     */
    public enum Verification {
        /** Well-formed, matching, recent. The only outcome that settles anything. */
        VERIFIED,
        /** A header or the body was absent — not a Cashfree callback at all. */
        MISSING_HEADER,
        /** Checked after the HMAC, so this genuinely means we signed it: a replay, or clock drift. */
        STALE,
        /** Timestamp not an integer, or signature not Base64 — nothing to compare either way. */
        MALFORMED,
        /**
         * Parsed but the HMAC differs. Reachable by any anonymous caller, so one occurrence is not
         * evidence the key is wrong.
         */
        MISMATCH
    }

    /**
     * Authenticity before freshness, so {@link Verification#STALE} cannot be produced by someone
     * who does not hold the secret. Anything but {@code VERIFIED} is dropped and still answers 200.
     */
    public Verification verify(String signature, String timestamp, String rawBody) {
        if (signature == null || timestamp == null || rawBody == null) {
            return Verification.MISSING_HEADER;
        }
        long sentAt;
        try {
            sentAt = Long.parseLong(timestamp.trim());
        } catch (NumberFormatException notATimestamp) {
            return Verification.MALFORMED;
        }
        byte[] presented;
        try {
            presented = Base64.getDecoder().decode(signature);
        } catch (IllegalArgumentException notBase64) {
            return Verification.MALFORMED;
        }
        // Computed-first, so the loop length never depends on the attacker's array.
        if (!MessageDigest.isEqual(hmac(timestamp, rawBody), presented)) {
            return Verification.MISMATCH;
        }
        return isFresh(sentAt) ? Verification.VERIFIED : Verification.STALE;
    }

    /**
     * Shared by {@link #verify} and {@link #sign} so the two cannot drift. Thrown rather than
     * refused: a missing HMAC-SHA256 is this JVM's fault, and would blame the sender in the log.
     */
    private byte[] hmac(String timestamp, String rawBody) {
        try {
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(secret, HMAC_SHA256));
            return mac.doFinal((timestamp + rawBody).getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException noHmac) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", noHmac);
        }
    }

    /**
     * Both units accepted because Cashfree posts seconds and {@link #sign} signs millis; neither
     * widens the window, since a value misread lands in 1970 or the year 57000.
     */
    private boolean isFresh(long sentAt) {
        // Math.abs(Long.MIN_VALUE) is itself negative, so now - 2^63 would compare as fresh.
        if (sentAt < 0) {
            return false;
        }
        long now = System.currentTimeMillis();
        return Math.abs(now - sentAt) <= MAX_SKEW_MILLIS
                || Math.abs(now / 1000L - sentAt) <= MAX_SKEW_MILLIS / 1000L;
    }

    /** Exists so tests run the real path: a check that is only ever mocked is a check nobody ran. */
    public String sign(String timestamp, String rawBody) {
        return Base64.getEncoder().encodeToString(hmac(timestamp, rawBody));
    }
}
