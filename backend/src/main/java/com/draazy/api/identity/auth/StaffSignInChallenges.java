package com.draazy.api.identity.auth;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.UnauthorizedException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The short-lived proof that a caller passed the password step, carried into the code step.
 * Deliberately not a JWT: nothing that parses access tokens can mistake one for a session.
 */
@Component
public class StaffSignInChallenges {

    static final Duration TTL = Duration.ofMinutes(5);
    private static final String EXPIRED = "Your sign-in has expired. Enter your email and password again.";

    private final byte[] key;

    public StaffSignInChallenges(@Value("${draazy.security.jwt.secret}") String jwtSecret) {
        // Derived, so the JWT key itself never signs anything but access tokens.
        this.key = hmac(jwtSecret.getBytes(StandardCharsets.UTF_8), "staff-sign-in-challenge-v1");
    }

    public String issue(UUID userId, Instant now) {
        String payload = userId + "." + now.plus(TTL).getEpochSecond();
        return payload + "." + sign(payload);
    }

    public UUID verify(String challenge, Instant now) {
        String[] parts = challenge == null ? new String[0] : challenge.split("\\.");
        if (parts.length != 3) {
            throw expired();
        }
        String payload = parts[0] + "." + parts[1];
        boolean signed = MessageDigest.isEqual(sign(payload).getBytes(StandardCharsets.US_ASCII),
                parts[2].getBytes(StandardCharsets.US_ASCII));
        try {
            if (!signed || now.getEpochSecond() >= Long.parseLong(parts[1])) {
                throw expired();
            }
            return UUID.fromString(parts[0]);
        } catch (IllegalArgumentException malformed) {
            throw expired();
        }
    }

    static UnauthorizedException expired() {
        return new UnauthorizedException(ErrorCodes.STAFF_SIGN_IN_EXPIRED, EXPIRED);
    }

    private String sign(String payload) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(key, payload));
    }

    private static byte[] hmac(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
