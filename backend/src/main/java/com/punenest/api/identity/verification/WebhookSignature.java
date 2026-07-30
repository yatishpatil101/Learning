package com.punenest.api.identity.verification;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
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
 * demoable with zero vendor keys; {@code application-prod.properties} binds the bare {@code ${...}}
 * lookup so a production boot without the real secret fails fast rather than running on a public one.
 * A <em>blank</em> secret is rejected outright at construction: an empty HMAC key still produces a
 * perfectly valid, publicly-computable signature, so {@code CASHFREE_WEBHOOK_SECRET=""} would silently
 * turn verification into a formality rather than failing loudly.
 */
@Component
public class WebhookSignature {

    private static final String HMAC_SHA256 = "HmacSHA256";

    /**
     * How far the signed timestamp may be from now. The signature alone proves authenticity, not
     * freshness — without a window, a payload captured once is replayable forever. Five minutes is the
     * usual provider allowance for retries and clock skew.
     */
    private static final long MAX_SKEW_MILLIS = 5 * 60 * 1000L;

    private final byte[] secret;

    public WebhookSignature(
            @Value("${punenest.webhooks.cashfree.secret}") String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "punenest.webhooks.cashfree.secret must be set (CASHFREE_WEBHOOK_SECRET); "
                            + "a blank webhook key makes every forged signature valid");
        }
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
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
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(secret, HMAC_SHA256));
            byte[] expected = mac.doFinal((timestamp + rawBody).getBytes(StandardCharsets.UTF_8));
            return MessageDigest.isEqual(expected, Base64.getDecoder().decode(signature));
        } catch (Exception cannotVerify) {
            return false;
        }
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
            Mac mac = Mac.getInstance(HMAC_SHA256);
            mac.init(new SecretKeySpec(secret, HMAC_SHA256));
            return Base64.getEncoder().encodeToString(
                    mac.doFinal((timestamp + rawBody).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HMAC-SHA256 unavailable", e);
        }
    }
}
