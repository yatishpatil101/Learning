package com.draazy.api.identity.verification;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

// HMAC, not plain SHA-256: the Aadhaar space is brute-forceable from a leaked dump.
@Component
public class IdentityHasher {

    private final byte[] key;

    public IdentityHasher(@Value("${draazy.security.identity-hash-secret}") String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("draazy.security.identity-hash-secret must be set");
        }
        this.key = secret.getBytes(StandardCharsets.UTF_8);
    }

    /** Hash of a canonical document number, namespaced by type so a PAN can never collide with a DL. */
    public String docHash(String docType, String canonicalNumber) {
        return hmac(docType + ":" + canonicalNumber);
    }

    /** Soft "same person" key (name+DOB); a reviewer signal only, never a rejection basis. */
    public String personKey(String name, LocalDate dob) {
        if (name == null || name.isBlank() || dob == null) {
            return null;
        }
        String n = name.trim().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
        return hmac("person:" + n + "|" + dob.getYear());
    }

    public String challengeMac(String payload) {
        return hmac("challenge:" + payload);
    }

    private String hmac(String input) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(input.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
