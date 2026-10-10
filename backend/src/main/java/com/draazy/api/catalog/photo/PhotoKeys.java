package com.draazy.api.catalog.photo;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Collection;
import java.util.HexFormat;
import java.util.UUID;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** {@code photos/<tag>/<uuid>}: the tag proves the uploader to the server without naming them in a public URL. */
@Component
public class PhotoKeys {

    private static final String UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

    // Pre-tag uploads carry the owner's user id where the tag now sits; they stay valid.
    private static final Pattern KEY =
            Pattern.compile("photos/([0-9a-f]{16}|" + UUID_RE + ")/(" + UUID_RE + ")(?:-[0-9a-f]{16})?");

    private final byte[] secret;

    public PhotoKeys(@Value("${draazy.security.jwt.secret}") String jwtSecret) {
        this.secret = hmac(jwtSecret.getBytes(StandardCharsets.UTF_8), "photo-key-v1");
    }

    public String newKey(UUID ownerId) {
        String id = UUID.randomUUID().toString();
        return "photos/" + tag(ownerId, id) + "/" + id;
    }

    public boolean uploadedBy(String key, Collection<UUID> owners) {
        var match = KEY.matcher(key);
        if (!match.matches()) {
            return false;
        }
        String scope = match.group(1);
        return owners.stream().anyMatch(owner -> scope.length() == 16
                ? MessageDigest.isEqual(tag(owner, match.group(2)).getBytes(StandardCharsets.US_ASCII),
                        scope.getBytes(StandardCharsets.US_ASCII))
                : scope.equals(owner.toString()));
    }

    private String tag(UUID owner, String photoId) {
        return HexFormat.of().formatHex(hmac(secret, owner + "/" + photoId), 0, 8);
    }

    private static byte[] hmac(byte[] key, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
