package com.punenest.api.common.payments;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * How long an unpaid checkout stays alive — the one number, owned in one place (D169).
 *
 * <p><strong>Why this is a bean and not a constant on the sweep.</strong> Two windows have to close
 * together. {@link AbandonedCheckoutSweep} retires <em>our</em> row once the TTL has passed; the
 * gateway order behind it stays payable until Cashfree's own {@code order_expiry_time}, which
 * {@code CashfreePaymentGateway} sends on create. If those two numbers are written down twice they
 * will drift, and the direction they drift in decides whether the platform loses money: our side
 * closing first is exactly D169 — a customer who kept the checkout tab open pays an order whose row
 * has already been retired. For rent that is a <em>double</em> charge, because the retired row
 * frees the month and the tenant may have paid it again in the meantime.
 *
 * <p>So the TTL is read once, here, and both consumers take this object. There is no second place
 * to change and therefore nothing to keep in step by hand.
 *
 * <p><strong>Why the kernel owns it rather than the provider.</strong> The number is a product
 * decision — how long a customer is given to finish paying — not a vendor detail, and the sweep
 * that acts on it lives here. The <em>wire format</em> is Cashfree's business and stays in
 * {@code provider}: this class hands out an {@link Instant} and never a formatted string, for the
 * same reason {@link AbandonedCheckouts} hands out an instant and a count.
 *
 * <p><strong>Configurable, with the default declared in code.</strong> No environment needs to
 * state this to get a sensible one, and it is a number an operator might want to move after
 * watching real abandonment behaviour. Minutes rather than a {@code Duration} so the value binds
 * with no converter in play and reads unambiguously in a properties file.
 */
@Component
public class CheckoutTtl {

    private static final Logger log = LoggerFactory.getLogger(CheckoutTtl.class);

    /**
     * Forty-five minutes.
     *
     * <p>Bounded below by the checkout itself: the single-use Cashfree payment session handed to
     * the SDK is short-lived, so a customer who has not paid within the hour cannot resume the
     * checkout they were given and would have to start again regardless — retiring the row is
     * telling them the truth, not taking anything away. Bounded above by the D160 cap: every minute
     * the row survives is a minute that product is closed to them. Forty-five leaves comfortable
     * room for the slow real cases — fetching a card, switching to a bank app, being interrupted —
     * while keeping the worst case (TTL plus one sweep interval) under an hour.
     *
     * <p>One number for all four payment families on purpose. They are the same situation seen from
     * four tables, and per-family TTLs would be four knobs nobody can reason about together — the
     * value is set by how long a gateway session lives, which is not a property of what was bought.
     */
    static final long DEFAULT_MINUTES = 45;

    /**
     * The shortest TTL that can still be mirrored at the gateway.
     *
     * <p>Cashfree refuses an {@code order_expiry_time} that is not comfortably in the future, so a
     * TTL below this could not be sent with the order at all — and an operator who set one would
     * get exactly the failure mode D169 describes, silently: our sweep closing early against a
     * gateway order with no expiry on it. Clamping keeps the two windows aligned by construction;
     * refusing to boot would be a harsher answer to a misconfiguration that has a safe reading.
     *
     * <p>It is a floor on the <em>shared</em> number rather than on the provider's copy of it
     * deliberately. Clamping inside the gateway would mean the gateway and the sweep disagreed
     * about the TTL, which is the one property this class exists to guarantee.
     */
    static final Duration GATEWAY_MINIMUM = Duration.ofMinutes(15);

    private final Duration duration;

    public CheckoutTtl(
            @Value("${punenest.payments.abandoned-checkout-ttl-minutes:" + DEFAULT_MINUTES + "}")
            long ttlMinutes) {
        this.duration = clamp(Duration.ofMinutes(ttlMinutes));
    }

    private static Duration clamp(Duration configured) {
        if (configured.compareTo(GATEWAY_MINIMUM) < 0) {
            log.warn("punenest.payments.abandoned-checkout-ttl-minutes={} is below the {} minute "
                    + "gateway minimum; using {} minutes so the sweep and the gateway order expire "
                    + "together", configured.toMinutes(), GATEWAY_MINIMUM.toMinutes(),
                    GATEWAY_MINIMUM.toMinutes());
            return GATEWAY_MINIMUM;
        }
        return configured;
    }

    /** The effective TTL, after clamping. Both windows are derived from this and nothing else. */
    public Duration duration() {
        return duration;
    }

    /**
     * Rows created before this instant have run out of checkout time.
     *
     * @param now the sweep's idea of the current time, passed in so a test can drive a lifecycle
     *            without waiting on a wall clock
     */
    public Instant cutoffFrom(Instant now) {
        return now.minus(duration);
    }

    /**
     * When a gateway order opened at {@code now} must stop being payable.
     *
     * <p>The mirror image of {@link #cutoffFrom}: the sweep looks back by the TTL and the gateway
     * looks forward by it, so an order created at the same moment as its row expires at the gateway
     * at the same moment the sweep would retire the row.
     */
    public Instant expiryFrom(Instant now) {
        return now.plus(duration);
    }
}
