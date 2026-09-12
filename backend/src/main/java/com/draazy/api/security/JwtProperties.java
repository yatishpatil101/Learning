package com.draazy.api.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * JWT configuration. The secret is env-driven (never committed for real environments); TTLs default
 * per ADR-008 (15-min access, 30-day refresh) but stay overridable.
 *
 * @param secret       HS256 signing key; must be ≥ 32 bytes
 * @param accessTtl    access-token lifetime
 * @param refreshTtl   refresh-token lifetime
 * @param refreshGrace how long after a rotation the spent token may be re-presented without being
 *                     treated as theft — see {@code RefreshTokenService.rotate}
 */
@ConfigurationProperties(prefix = "draazy.security.jwt")
public record JwtProperties(
        String secret,
        @DefaultValue("15m") Duration accessTtl,
        @DefaultValue("30d") Duration refreshTtl,
        @DefaultValue("15s") Duration refreshGrace) {

    /**
     * How long a grace window may be before it is not a window. Two tabs waking together are
     * milliseconds apart and a slow mobile round trip is seconds, so a minute is already generous by
     * an order of magnitude; past that, "was this a race?" stops being a question about timing.
     */
    private static final Duration MAX_GRACE = Duration.ofMinutes(1);

    /**
     * Refuse to start on a configuration that would quietly disable an auth control.
     *
     * <p>These are three lines of arithmetic that decide whether a session exists, and they are read
     * from a properties file that an operator edits by hand, so a typo is the expected failure and
     * not an exotic one. What makes it worth a guard rather than a comment is that every mistake
     * here is <em>silent</em>: nothing throws, no endpoint 500s, the wrong behaviour simply becomes
     * the behaviour. A boot failure names the property and the value, which is the shortest path
     * from the typo to the fix.
     *
     * <ul>
     *   <li><strong>A grace window that is too long</strong> is the one that actually costs
     *       security. {@code refresh-grace=30d} forgives every replay for the life of the token, so
     *       reuse-detection is off while still appearing, in the code and in every test, to be on.
     *       {@code MAX_CONSECUTIVE_GRACES} does not save it: a stolen token is served from the live
     *       head, so the thief rotates cleanly from then on and never accumulates a second
     *       consecutive grace.</li>
     *   <li><strong>A negative grace window</strong> puts the floor in the future, so no heir is
     *       ever fresh enough and the tripwire fires on races it was written to forgive. Zero is
     *       allowed and means exactly that, deliberately: it is how the test properties pin the
     *       window shut so the paths either side of it can be tested apart.</li>
     *   <li><strong>A non-positive TTL</strong> mints credentials that are already expired, which
     *       reads from the outside as a login that silently does not work.</li>
     *   <li><strong>An access token outliving its refresh token</strong> inverts the whole scheme.
     *       Short access plus long refresh is the trade — revocation is checked at rotation, and a
     *       long-lived access token cannot be revoked at all — so this ordering is the design, not
     *       a preference.</li>
     * </ul>
     */
    public JwtProperties {
        if (accessTtl == null || accessTtl.isNegative() || accessTtl.isZero()) {
            throw new IllegalArgumentException(
                    "draazy.security.jwt.access-ttl must be positive, was " + accessTtl);
        }
        if (refreshTtl == null || refreshTtl.isNegative() || refreshTtl.isZero()) {
            throw new IllegalArgumentException(
                    "draazy.security.jwt.refresh-ttl must be positive, was " + refreshTtl);
        }
        if (refreshTtl.compareTo(accessTtl) < 0) {
            throw new IllegalArgumentException(
                    "draazy.security.jwt.refresh-ttl (" + refreshTtl + ") must not be shorter "
                            + "than access-ttl (" + accessTtl + "): a refresh token that dies first "
                            + "leaves nothing to rotate");
        }
        if (refreshGrace == null || refreshGrace.isNegative()) {
            throw new IllegalArgumentException(
                    "draazy.security.jwt.refresh-grace must not be negative, was " + refreshGrace);
        }
        if (refreshGrace.compareTo(MAX_GRACE) > 0) {
            throw new IllegalArgumentException(
                    "draazy.security.jwt.refresh-grace (" + refreshGrace + ") exceeds the "
                            + MAX_GRACE + " ceiling: a window this wide forgives every replay and "
                            + "turns reuse-detection off without appearing to");
        }
    }
}
