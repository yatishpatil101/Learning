package com.punenest.api.identity.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Refresh-token primitives. Tokens are high-entropy random strings handed to the client; only their
 * SHA-256 is persisted, so a DB leak can't be replayed. SHA-256 (not BCrypt) is deliberate: the
 * token already has 256 bits of entropy, so a fast deterministic digest is enough and lets us look
 * a token up by hash in one indexed query.
 */
public final class Tokens {

    private static final SecureRandom RANDOM = new SecureRandom();

    private Tokens() {
    }

    /** A new 256-bit URL-safe opaque token. */
    public static String randomToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Lower-case hex SHA-256 of a token, for storage/lookup. */
    public static String sha256Hex(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e); // never happens on a JRE
        }
    }

    /**
     * Constant-time equality of two hex hashes. Uses {@link MessageDigest#isEqual} so verifying an OTP
     * or token doesn't leak, via response timing, how many leading characters matched — closing a
     * timing side-channel on the guess path.
     */
    public static boolean hashesEqual(String a, String b) {
        return MessageDigest.isEqual(
                a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
