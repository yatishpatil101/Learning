package com.punenest.api.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * Proof that a request URI carrying the document share token cannot reach a log intact (D42).
 *
 * <p>A unit test on purpose, for the same reason {@code MobileMaskTest} is one: the rule this pins
 * is a security rule with no HTTP in it, and it has to fail loudly the moment someone edits the
 * helper — not be inferred from the happy path of an endpoint test.
 */
class LogSafeUriTest {

    private static final String TOKEN = "8mQ2r-3fV_kZ1pW7sT0xY9aB4cD6eF8gH2iJ4kL6mN8";

    @Test
    void masksTheShareTokenAndNothingElse() {
        assertThat(LogSafeUri.redact("/api/documents/shared?token=" + TOKEN))
                .isEqualTo("/api/documents/shared?token=REDACTED")
                .doesNotContain(TOKEN);
    }

    @Test
    void keepsTheRestOfTheQueryReadable() {
        // The point of redacting rather than dropping the query string: the line still says which
        // page and which filter, which is the half an operator is reading it for.
        assertThat(LogSafeUri.redact("/api/documents/shared?page=2&token=" + TOKEN + "&size=20"))
                .isEqualTo("/api/documents/shared?page=2&token=REDACTED&size=20");
    }

    @Test
    void masksEveryOccurrence() {
        // A duplicated parameter is what a hand-assembled or double-appended link looks like.
        // Masking only the first would leak the value while appearing to have worked.
        assertThat(LogSafeUri.redact("/x?token=" + TOKEN + "&token=" + TOKEN))
                .isEqualTo("/x?token=REDACTED&token=REDACTED");
    }

    @Test
    void matchesTheParameterNameCaseInsensitively() {
        assertThat(LogSafeUri.redact("/x?Token=" + TOKEN)).isEqualTo("/x?Token=REDACTED");
        assertThat(LogSafeUri.redact("/x?ACCESS_TOKEN=" + TOKEN))
                .isEqualTo("/x?ACCESS_TOKEN=REDACTED");
    }

    @Test
    void leavesAUriWithNothingToHideExactlyAsItWas() {
        assertThat(LogSafeUri.redact("/api/properties")).isEqualTo("/api/properties");
        assertThat(LogSafeUri.redact("/api/properties?city=pune"))
                .isEqualTo("/api/properties?city=pune");
        assertThat(LogSafeUri.redact("/api/properties?")).isEqualTo("/api/properties?");
        assertThat(LogSafeUri.redact(null)).isNull();
    }

    @Test
    void doesNotInventAValueForAValuelessParameter() {
        // `?token` on its own carries no secret; rewriting it to `token=REDACTED` would make the
        // log claim a value was sent when none was.
        assertThat(LogSafeUri.redact("/x?token")).isEqualTo("/x?token");
        assertThat(LogSafeUri.redact("/x?token=")).isEqualTo("/x?token=REDACTED");
    }

    @Test
    void doesNotMatchOnASubstringOfAnInnocentParameter() {
        // `tokenCount` is not `token`. A contains()-based implementation would mask it, and the
        // reverse mistake — masking `token` only when it is the whole name — is the one that
        // matters, so both directions are pinned.
        assertThat(LogSafeUri.redact("/x?tokenCount=3")).isEqualTo("/x?tokenCount=3");
        assertThat(LogSafeUri.redact("/x?mytoken=" + TOKEN)).isEqualTo("/x?mytoken=" + TOKEN);
    }
}
