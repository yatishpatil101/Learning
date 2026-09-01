package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Three durations that decide whether a session exists, read from a file an operator edits by hand.
 *
 * <p>These tests are about the <em>silence</em> of the failures rather than their severity. A
 * refresh window of {@code 30d} does not throw, does not log, and does not fail a single existing
 * test — reuse-detection simply stops detecting reuse while every line of code that implements it
 * stays exactly as written. That is the shape of misconfiguration the constructor exists to catch,
 * and the shape a test has to pin, because nothing downstream ever will.
 */
class JwtPropertiesTest {

    private static final String SECRET = "a-thirty-two-byte-secret-for-hs384-signing";

    @Test
    void theShippedDefaultsAreAccepted() {
        // Guards against the guard: a constraint that rejects the values in application.properties
        // would take the whole service down, and would do it at boot in every environment at once.
        assertThatCode(() -> new JwtProperties(
                SECRET, Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofSeconds(15)))
                .doesNotThrowAnyException();
    }

    @Test
    void aGraceWindowOfZeroIsAllowed() {
        // src/test/resources sets refresh-grace=0s deliberately, so that the branch either side of
        // the window can be tested apart. Zero is a window shut, not a window missing.
        assertThatCode(() -> new JwtProperties(
                SECRET, Duration.ofMinutes(15), Duration.ofDays(30), Duration.ZERO))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a grace window measured in days turns reuse-detection off without appearing to")
    void anOverlyLongGraceWindowIsRejected() {
        // The one that actually costs security. Every replay inside the window is forgiven, and
        // MAX_CONSECUTIVE_GRACES does not save it: a thief is served from the live head and rotates
        // cleanly from then on, so a second consecutive grace never accumulates.
        assertThatThrownBy(() -> new JwtProperties(
                SECRET, Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofDays(30)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("refresh-grace")
                .hasMessageContaining("forgives every replay");
    }

    @Test
    void aNegativeGraceWindowIsRejected() {
        // Puts the freshness floor in the future, so no heir is ever new enough and the tripwire
        // fires on exactly the honest races it was written to forgive — a sign-out storm that looks
        // like a token bug.
        assertThatThrownBy(() -> new JwtProperties(
                SECRET, Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofSeconds(-1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("must not be negative");
    }

    @Test
    void nonPositiveLifetimesAreRejected() {
        // Mints credentials that are already expired, which presents as a login that appears to
        // succeed and then does nothing.
        assertThatThrownBy(() -> new JwtProperties(
                SECRET, Duration.ZERO, Duration.ofDays(30), Duration.ofSeconds(15)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("access-ttl must be positive");

        assertThatThrownBy(() -> new JwtProperties(
                SECRET, Duration.ofMinutes(15), Duration.ofMinutes(-1), Duration.ofSeconds(15)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("refresh-ttl must be positive");
    }

    @Test
    void anAccessTokenMayNotOutliveItsRefreshToken() {
        // Short access plus long refresh is the trade the whole scheme is built on — revocation is
        // only ever checked at rotation, so an access token that outlives the thing that renews it
        // is a credential nothing can withdraw.
        assertThatThrownBy(() -> new JwtProperties(
                SECRET, Duration.ofDays(2), Duration.ofDays(1), Duration.ofSeconds(15)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("leaves nothing to rotate");
    }
}
