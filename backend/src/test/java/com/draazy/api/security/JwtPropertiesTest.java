package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

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

    /**
     * Each row is a misconfiguration that is silent if let through: a grace window of days forgives
     * every replay (and {@code MAX_CONSECUTIVE_GRACES} does not save it, as a thief is served from
     * the live head); a negative one puts the freshness floor in the future so the tripwire fires on
     * honest races; non-positive lifetimes mint credentials already expired; and an access token
     * that outlives its refresh token is a credential nothing can withdraw, as revocation is only
     * checked at rotation.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("rejectedConfigs")
    void aMisconfiguredLifetimeIsRejected(String label, Duration access, Duration refresh,
            Duration grace, String[] messageParts) {
        assertThatThrownBy(() -> new JwtProperties(SECRET, access, refresh, grace))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContainingAll(messageParts);
    }

    static Stream<Arguments> rejectedConfigs() {
        Duration access = Duration.ofMinutes(15);
        Duration refresh = Duration.ofDays(30);
        Duration grace = Duration.ofSeconds(15);
        return Stream.of(
                Arguments.of("a grace window measured in days turns reuse-detection off without "
                        + "appearing to", access, refresh, Duration.ofDays(30),
                        new String[] {"refresh-grace", "forgives every replay"}),
                Arguments.of("a negative grace window", access, refresh, Duration.ofSeconds(-1),
                        new String[] {"must not be negative"}),
                Arguments.of("a zero access-ttl", Duration.ZERO, refresh, grace,
                        new String[] {"access-ttl must be positive"}),
                Arguments.of("a negative refresh-ttl", access, Duration.ofMinutes(-1), grace,
                        new String[] {"refresh-ttl must be positive"}),
                Arguments.of("an access token may not outlive its refresh token", Duration.ofDays(2),
                        Duration.ofDays(1), grace, new String[] {"leaves nothing to rotate"}));
    }
}
