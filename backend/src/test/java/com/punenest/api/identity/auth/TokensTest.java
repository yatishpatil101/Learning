package com.punenest.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TokensTest {

    @Test
    void randomTokensAreUniqueAndUrlSafe() {
        String a = Tokens.randomToken();
        String b = Tokens.randomToken();
        assertThat(a).isNotEqualTo(b);
        assertThat(a).matches("[A-Za-z0-9_-]+"); // base64url, no padding
    }

    @Test
    void sha256IsDeterministicAndHex() {
        String token = "some-token";
        assertThat(Tokens.sha256Hex(token)).isEqualTo(Tokens.sha256Hex(token));
        assertThat(Tokens.sha256Hex(token)).matches("[0-9a-f]{64}");
        assertThat(Tokens.sha256Hex("other")).isNotEqualTo(Tokens.sha256Hex(token));
    }

    @Test
    void hashesEqualIsTrueOnlyForIdenticalHashes() {
        String h = Tokens.sha256Hex("code");
        assertThat(Tokens.hashesEqual(h, Tokens.sha256Hex("code"))).isTrue();
        assertThat(Tokens.hashesEqual(h, Tokens.sha256Hex("nope"))).isFalse();
        assertThat(Tokens.hashesEqual(h, "short")).isFalse(); // differing lengths must not throw
    }
}
