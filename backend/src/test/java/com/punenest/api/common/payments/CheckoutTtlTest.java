package com.punenest.api.common.payments;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The one TTL both checkout windows are derived from — D169.
 *
 * <p><strong>What this is really asserting.</strong> Not that the arithmetic is right; that is one
 * line and obvious. It is that {@code cutoffFrom} and {@code expiryFrom} are the <em>same</em>
 * number pointed in opposite directions. D169 was two windows written down twice and drifting, and
 * the shape of the regression is somebody adding a second constant "just for the gateway" — at
 * which point the symmetry assertion below is the thing that stops it.
 *
 * <p>A plain unit test rather than a Spring one, following {@code PageResponseTest}: the class takes
 * its configuration through the constructor precisely so it can be exercised without a context, and
 * a context here would prove Spring's binder works rather than that this class does.
 */
@DisplayName("D169 — one TTL feeds both the sweep's look-back and the gateway's look-forward")
class CheckoutTtlTest {

    /** Fixed rather than {@code Instant.now()}: a clock is not a variable of the thing under test. */
    private static final Instant NOW = Instant.parse("2026-03-14T09:30:00Z");

    /**
     * The regression guard proper. If the two windows are ever computed from separate numbers this
     * fails no matter which of them was changed, and it fails without needing to know the value.
     */
    @Test
    @DisplayName("the look-back and the look-forward are the same span, mirrored about now")
    void bothWindowsAreTheSameSpan() {
        CheckoutTtl ttl = new CheckoutTtl(45);

        assertThat(Duration.between(ttl.cutoffFrom(NOW), NOW)).isEqualTo(ttl.duration());
        assertThat(Duration.between(NOW, ttl.expiryFrom(NOW))).isEqualTo(ttl.duration());
        assertThat(Duration.between(ttl.cutoffFrom(NOW), ttl.expiryFrom(NOW)))
                .isEqualTo(ttl.duration().multipliedBy(2));
    }

    /**
     * Fails if the default is quietly moved. It is not a magic number to be tuned in passing: it is
     * bounded below by how long a Cashfree payment session survives and above by the D160 unpaid
     * cap, and both of those are argued in the field's Javadoc rather than here.
     */
    @Test
    @DisplayName("an unconfigured deployment gets forty-five minutes")
    void theDefaultIsDeclaredInCode() {
        assertThat(CheckoutTtl.DEFAULT_MINUTES).isEqualTo(45);
        assertThat(new CheckoutTtl(CheckoutTtl.DEFAULT_MINUTES).duration())
                .isEqualTo(Duration.ofMinutes(45));
    }

    @Test
    @DisplayName("a longer TTL is honoured as configured")
    void aLongerTtlIsTakenAtFaceValue() {
        assertThat(new CheckoutTtl(120).duration()).isEqualTo(Duration.ofMinutes(120));
    }

    /**
     * The misconfiguration that would silently recreate D169. Cashfree will not accept an expiry
     * this close, so a five-minute TTL could not be mirrored on the order at all — leaving our sweep
     * closing early against an order with no expiry, which is precisely the bug. Clamping is what
     * keeps the guarantee true for every configured value rather than only sensible ones.
     */
    @Test
    @DisplayName("a TTL below the gateway minimum is clamped, not silently unmirrored")
    void aTooShortTtlIsClamped() {
        assertThat(new CheckoutTtl(5).duration()).isEqualTo(CheckoutTtl.GATEWAY_MINIMUM);
        assertThat(new CheckoutTtl(0).duration()).isEqualTo(CheckoutTtl.GATEWAY_MINIMUM);
    }

    /**
     * Clamping must happen once, on the shared number — not inside the gateway. If it were applied
     * in {@code CashfreePaymentGateway} instead, the gateway would be using fifteen minutes while
     * the sweep used five, which is a drift of exactly the kind D169 is about. This asserts the two
     * windows still agree <em>after</em> the clamp.
     */
    @Test
    @DisplayName("a clamped TTL still leaves both windows in step")
    void clampingKeepsBothWindowsInStep() {
        CheckoutTtl ttl = new CheckoutTtl(1);

        assertThat(Duration.between(ttl.cutoffFrom(NOW), NOW))
                .isEqualTo(Duration.between(NOW, ttl.expiryFrom(NOW)));
    }
}
