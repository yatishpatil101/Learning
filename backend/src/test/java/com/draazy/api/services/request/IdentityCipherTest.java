package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Base64;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("D283 \u2014 PAN and Aadhaar are AES-256-GCM at rest, keyed by id")
class IdentityCipherTest {

    private static final String KEY_A = Base64.getEncoder().encodeToString(new byte[32]);
    private static final String KEY_B = Base64.getEncoder().encodeToString("b".repeat(32).getBytes());

    @Test
    @DisplayName("a value round-trips, never appears in the stored form, and is sealed afresh each time")
    void roundTrip() {
        IdentityCipher cipher = new IdentityCipher(KEY_A, "k1", "");
        String sealed = cipher.encrypt("211122223335");
        assertThat(sealed).startsWith("enc:v1:k1:").doesNotContain("211122223335");
        assertThat(cipher.encrypt("211122223335")).isNotEqualTo(sealed);
        assertThat(cipher.decrypt(sealed)).isEqualTo("211122223335");
        assertThat(cipher.encrypt(null)).isNull();
        assertThat(cipher.decrypt(null)).isNull();
    }

    @Test
    @DisplayName("a row written before encryption reads back as it was stored")
    void legacyPlaintextPassesThrough() {
        assertThat(new IdentityCipher(KEY_A, "k1", "").decrypt("ABCDE1234F")).isEqualTo("ABCDE1234F");
    }

    @Test
    @DisplayName("after rotation, rows sealed under the retired key still open")
    void rotation() {
        String old = new IdentityCipher(KEY_A, "k1", "").encrypt("ABCDE1234F");
        IdentityCipher rotated = new IdentityCipher(KEY_B, "k2", "k1:" + KEY_A);
        assertThat(rotated.decrypt(old)).isEqualTo("ABCDE1234F");
        assertThat(rotated.encrypt("ABCDE1234F")).startsWith("enc:v1:k2:");
    }

    @Test
    @DisplayName("an unknown key id or a tampered value fails loudly rather than reading as empty")
    void failsClosed() {
        String sealed = new IdentityCipher(KEY_A, "k1", "").encrypt("ABCDE1234F");
        assertThatThrownBy(() -> new IdentityCipher(KEY_B, "k2", "").decrypt(sealed))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("k1");
        String tampered = sealed.substring(0, sealed.length() - 4) + "AAAA";
        assertThatThrownBy(() -> new IdentityCipher(KEY_A, "k1", "").decrypt(tampered))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("a key that is not 32 bytes, or a malformed id, refuses to boot")
    void validatedAtStartup() {
        String short16 = Base64.getEncoder().encodeToString(new byte[16]);
        assertThatThrownBy(() -> new IdentityCipher(short16, "k1", ""))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("32 bytes");
        assertThatThrownBy(() -> new IdentityCipher("not base64!", "k1", ""))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new IdentityCipher(KEY_A, "Bad:Id", ""))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> new IdentityCipher(KEY_A, "k1", "k1:" + KEY_B))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("twice");
    }
}
