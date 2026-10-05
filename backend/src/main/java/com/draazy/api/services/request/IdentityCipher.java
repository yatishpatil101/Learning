package com.draazy.api.services.request;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

// Identity numbers are encrypted at rest; key ids stay in the payload so retired keys can decrypt old rows.
@Component
public class IdentityCipher {

    private static final String PREFIX = "enc:v1:";
    private static final Pattern KEY_ID = Pattern.compile("[a-z0-9-]{1,16}");
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecureRandom random = new SecureRandom();
    private final String currentId;
    private final Map<String, SecretKey> keys = new HashMap<>();

    public IdentityCipher(
            @Value("${draazy.security.identity-key}") String key,
            @Value("${draazy.security.identity-key-id}") String keyId,
            @Value("${draazy.security.identity-retired-keys:}") String retired) {
        this.currentId = requireKeyId(keyId);
        keys.put(currentId, aesKey(key, "draazy.security.identity-key"));
        if (retired != null && !retired.isBlank()) {
            for (String entry : retired.split(",")) {
                String[] parts = entry.trim().split(":", 2);
                if (parts.length != 2) {
                    throw new IllegalStateException(
                            "draazy.security.identity-retired-keys entries must be keyId:base64key");
                }
                String id = requireKeyId(parts[0]);
                if (keys.containsKey(id)) {
                    throw new IllegalStateException("identity key id '" + id + "' is declared twice");
                }
                keys.put(id, aesKey(parts[1], "retired identity key '" + id + "'"));
            }
        }
    }

    public String encrypt(String plaintext) {
        if (plaintext == null) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, keys.get(currentId), new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(currentId.getBytes(StandardCharsets.UTF_8));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] out = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array();
            return PREFIX + currentId + ":" + Base64.getEncoder().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("identity number could not be encrypted", e);
        }
    }

    public String decrypt(String stored) {
        if (stored == null || !stored.startsWith(PREFIX)) {
            return stored;
        }
        int split = stored.indexOf(':', PREFIX.length());
        if (split < 0) {
            throw new IllegalStateException("malformed encrypted identity number");
        }
        String id = stored.substring(PREFIX.length(), split);
        SecretKey key = keys.get(id);
        if (key == null) {
            throw new IllegalStateException("no identity key with id '" + id + "' is configured");
        }
        try {
            byte[] in = Base64.getDecoder().decode(stored.substring(split + 1));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, in, 0, IV_BYTES));
            cipher.updateAAD(id.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(in, IV_BYTES, in.length - IV_BYTES), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException("identity number could not be decrypted", e);
        }
    }

    private static String requireKeyId(String id) {
        String trimmed = id == null ? "" : id.trim();
        if (!KEY_ID.matcher(trimmed).matches()) {
            throw new IllegalStateException(
                    "identity key id must be 1-16 of [a-z0-9-]; got '" + trimmed + "'");
        }
        return trimmed;
    }

    private static SecretKey aesKey(String base64, String name) {
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(base64 == null ? "" : base64.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(name + " is not valid base64", e);
        }
        if (raw.length != 32) {
            throw new IllegalStateException(name + " must decode to 32 bytes (AES-256); got " + raw.length);
        }
        return new SecretKeySpec(raw, "AES");
    }
}
