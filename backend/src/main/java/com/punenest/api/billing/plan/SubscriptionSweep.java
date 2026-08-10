package com.punenest.api.billing.plan;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The timer that ends lapsed subscriptions (D57).
 *
 * <p><strong>Why this is a separate class from {@link SubscriptionService}.</strong> The trigger and
 * the work are different concerns with different failure modes: the work is a transaction that must
 * be tested, and the trigger is a schedule that must not fire during tests. Splitting them lets
 * {@code SubscriptionService.expireLapsed(now)} be called directly with a fabricated instant, so
 * the lifecycle is proved without any test waiting on a wall clock.
 *
 * <p><strong>Why the sweep is not the entitlement rule.</strong> It only makes the stored status
 * honest. Whether a plan entitles is decided against the clock on every read — see
 * {@code SubscriptionService.currentFor} — because a job that runs hourly would otherwise grant up
 * to an hour of benefits nobody paid for.
 *
 * <p><strong>Single-instance assumption.</strong> Two application instances would each run this and
 * both would try to expire the same rows. That is presently harmless — {@code expire()} is a
 * no-op on a row already expired, and the transaction serialises the writers — but it is not a
 * design that scales to a real cluster, where this should become a locked or leader-elected job.
 * Recorded rather than solved because the platform runs one instance today.
 */
@Component
@ConditionalOnProperty(name = "punenest.billing.subscription-sweep.enabled",
        havingValue = "true", matchIfMissing = true)
public class SubscriptionSweep {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionSweep.class);

    /**
     * One hour. Terms end on a calendar boundary, so the resolution that matters is "the same day",
     * and anything finer only adds database traffic. Expressed as a literal rather than a property
     * because a knob nobody has asked to turn is a knob that will be set wrong.
     */
    private static final long EVERY_HOUR_MS = 60L * 60L * 1000L;

    /**
     * Five minutes after boot. Not zero: startup is when the connection pool, Flyway and the
     * context are all still contending, and a table scan is the last thing that should join that
     * queue. Nothing is time-critical here — a subscription that lapsed overnight has already
     * stopped entitling.
     */
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    private final SubscriptionService subscriptions;

    public SubscriptionSweep(SubscriptionService subscriptions) {
        this.subscriptions = subscriptions;
    }

    /**
     * {@code fixedDelay}, not {@code fixedRate}: the next run is measured from the end of the last
     * one, so a slow sweep can never overlap itself.
     */
    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void expireLapsedSubscriptions() {
        try {
            int ended = subscriptions.expireLapsed(Instant.now());
            if (ended > 0) {
                log.info("Subscription sweep expired {} lapsed subscription(s)", ended);
            }
        } catch (RuntimeException e) {
            // why: an uncaught exception cancels the schedule for the lifetime of the process, so
            // one bad tick would silently stop every later one. Log and let the next tick retry.
            log.error("Subscription sweep failed; will retry on the next tick", e);
        }
    }
}
