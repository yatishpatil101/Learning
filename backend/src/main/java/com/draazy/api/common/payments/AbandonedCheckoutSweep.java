package com.draazy.api.common.payments;

import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "draazy.payments.checkout-sweep.enabled",
        havingValue = "true", matchIfMissing = true)
public class AbandonedCheckoutSweep {

    private static final Logger log = LoggerFactory.getLogger(AbandonedCheckoutSweep.class);

    // Runs more often than bookkeeping sweeps because uncleared rows block checkout.
    private static final long EVERY_TEN_MINUTES_MS = 10L * 60L * 1000L;

    // Five minutes after boot, matching `SubscriptionSweep`.
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    private final List<AbandonedCheckouts> families;

    private final CheckoutTtl ttl;

    public AbandonedCheckoutSweep(List<AbandonedCheckouts> families, CheckoutTtl ttl) {
        this.families = families;
        this.ttl = ttl;
    }

    // `fixedDelay` prevents a slow sweep from overlapping and racing its own writes.
    @Scheduled(fixedDelay = EVERY_TEN_MINUTES_MS, initialDelay = AFTER_STARTUP_MS)
    public void expireAbandonedCheckouts() {
        Instant cutoff = ttl.cutoffFrom(Instant.now());
        for (AbandonedCheckouts family : families) {
            sweep(family, cutoff);
        }
    }

    // Per-family handling keeps one broken expiry query from stopping the rest.
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
