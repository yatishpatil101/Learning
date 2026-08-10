package com.punenest.api.common.payments;

import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The one timer that closes checkouts nobody came back to, across every family that opens a gateway
 * order (D161).
 *
 * <p><strong>The gap it fills.</strong> D148 split every payment path into commit-then-open-order,
 * which is right: the row exists before the order does, so a failure between the two cannot leave a
 * payable order with nothing behind it. The compensation for that failure ({@code abandon}) runs in
 * the same process, so it covers an exception and not a hard kill — SIGKILL, an OOM, a node
 * eviction between the local commit and the gateway call leaves a row that is unpaid, unreachable
 * and uncompensated. D152 gave service requests a sweep for exactly this; subscriptions, boosts and
 * rent had none, so their stranded rows were indistinguishable from a customer still deciding.
 *
 * <p><strong>It is also what makes the D160 cap safe.</strong> One outstanding unpaid order per
 * user per family is only a reasonable rule if the outstanding order eventually goes away. Without
 * a sweep the cap is a latch: abandon one checkout and that product is closed to you forever. The
 * two items ship together for that reason.
 *
 * <p><strong>Why one class rather than four.</strong> The trigger is identical at all four sites —
 * subtract a TTL from now, call the work, log what moved — and four copies of it would drift. The
 * <em>work</em> stays in each service, because the transition does not generalise; see
 * {@link AbandonedCheckouts}. This replaces {@code ServiceRequestCheckoutSweep}, which was this
 * class with one implementation hard-coded into it.
 *
 * <p><strong>Why this is a separate class from the services</strong> — the same reason
 * {@code SubscriptionSweep} is separate from {@code SubscriptionService}. The trigger and the work
 * have different failure modes: the work is a transaction that must be tested, and the trigger is a
 * schedule that must not fire during tests. Splitting them lets
 * {@code expireAbandonedCheckouts(cutoff)} be called directly with a fabricated instant, so every
 * lifecycle is proved without any test waiting on a wall clock.
 *
 * <p><strong>Single-instance assumption.</strong> Two application instances would each run this and
 * both would try to retire the same rows. Presently harmless — the second finds the row no longer
 * unpaid, or loses on {@code @Version} — but it is not a design that scales to a real cluster,
 * where this should become a locked or leader-elected job. The same note stands on
 * {@code SubscriptionSweep}, and they should be fixed together.
 */
@Component
@ConditionalOnProperty(name = "punenest.payments.checkout-sweep.enabled",
        havingValue = "true", matchIfMissing = true)
public class AbandonedCheckoutSweep {

    private static final Logger log = LoggerFactory.getLogger(AbandonedCheckoutSweep.class);

    /**
     * Ten minutes. Finer than {@code SubscriptionSweep}'s hour because the thing being freed is not
     * bookkeeping: until the row clears, the D160 cap keeps the customer from buying that product
     * again. An hour of being told "you already have an unpaid order" after deciding not to pay is a
     * support ticket, so the sweep runs at roughly a quarter of the TTL and the worst case is under
     * an hour from abandonment to a usable product.
     */
    private static final long EVERY_TEN_MINUTES_MS = 10L * 60L * 1000L;

    /**
     * Five minutes after boot, matching {@code SubscriptionSweep}. Not zero: startup is when the
     * connection pool, Flyway and the context are all still contending, and nothing here is
     * time-critical — a checkout abandoned overnight has been abandoned either way.
     */
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    /**
     * Every family that can strand a checkout. Injected as a list rather than named one by one, so
     * a fifth payment path is swept by implementing the port — which is the only version of this
     * that a future author cannot forget to update.
     */
    private final List<AbandonedCheckouts> families;

    /**
     * How long an unpaid order is left alone before it is treated as abandoned.
     *
     * <p><strong>The same object the gateway uses to set {@code order_expiry_time}</strong> (D169).
     * This class looks <em>back</em> by the TTL to find rows that have run out of time; the gateway
     * looks <em>forward</em> by it when it opens the order. Before D169 our row was retired while
     * the Cashfree order behind it stayed payable for weeks, so a customer with the checkout tab
     * still open could pay against a row that had already moved on — and for rent that was a second
     * charge for a month the retirement had just freed. Both windows now come from
     * {@link CheckoutTtl}, so there is no second number to keep in step.
     */
    private final CheckoutTtl ttl;

    public AbandonedCheckoutSweep(List<AbandonedCheckouts> families, CheckoutTtl ttl) {
        this.families = families;
        this.ttl = ttl;
    }

    /**
     * {@code fixedDelay}, not {@code fixedRate}: the next run is measured from the end of the last
     * one, so a slow sweep can never overlap itself and race its own writes.
     */
    @Scheduled(fixedDelay = EVERY_TEN_MINUTES_MS, initialDelay = AFTER_STARTUP_MS)
    public void expireAbandonedCheckouts() {
        Instant cutoff = ttl.cutoffFrom(Instant.now());
        for (AbandonedCheckouts family : families) {
            sweep(family, cutoff);
        }
    }

    /**
     * One family, guarded on its own.
     *
     * <p>The try/catch is per family rather than around the loop for two reasons. An uncaught
     * exception cancels the schedule for the lifetime of the process, so one bad tick would
     * silently stop every later one — that is why it is caught at all. And catching it out here
     * would mean a broken rent query stopped subscriptions and boosts from being swept in the same
     * tick, which is a failure in one table quietly becoming a lockout in three.
     */
    private void sweep(AbandonedCheckouts family, Instant cutoff) {
        try {
            int expired = family.expireAbandonedCheckouts(cutoff);
            if (expired > 0) {
                log.info("Checkout sweep retired {} {}(s) unpaid since before {}",
                        expired, family.family(), cutoff);
            }
        } catch (RuntimeException e) {
            log.error("Checkout sweep failed for {}; will retry on the next tick",
                    family.family(), e);
        }
    }
}
