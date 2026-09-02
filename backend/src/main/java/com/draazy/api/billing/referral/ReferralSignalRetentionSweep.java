package com.draazy.api.billing.referral;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodic expiry of the referral correlation digests (D55).
 *
 * <p>Runs as a separate trigger class so the expiry itself is testable directly on
 * {@link ReferralSignalRetention#expireSignalsOlderThan}, at a cutoff the test chooses, rather than
 * by waiting on wall-clock timers — the same split, for the same reason, as
 * {@code RefreshTokenPruningSweep}.
 *
 * <p>Disabled in the test suite. A background thread blanking digests outside a test's transaction
 * would fail whichever test happened to be asserting on a freshly seeded referral, which is both
 * random and unrelated to the code under test.
 */
@Component
@ConditionalOnProperty(name = "draazy.referrals.signal-retention.enabled",
        havingValue = "true", matchIfMissing = true)
public class ReferralSignalRetentionSweep {

    private static final Logger log = LoggerFactory.getLogger(ReferralSignalRetentionSweep.class);

    // Daily: the window is ninety days, so a tick that lands hours late costs nothing, and a
    // tighter schedule would spend almost every run finding nothing.
    private static final long EVERY_DAY_MS = 24L * 60L * 60L * 1000L;

    // Let startup settle before the first pass.
    private static final long AFTER_STARTUP_MS = 10L * 60L * 1000L;

    private final ReferralSignalRetention retention;

    public ReferralSignalRetentionSweep(ReferralSignalRetention retention) {
        this.retention = retention;
    }

    @Scheduled(fixedDelay = EVERY_DAY_MS, initialDelay = AFTER_STARTUP_MS)
    public void expireSignals() {
        try {
            retention.expireNow();
        } catch (RuntimeException e) {
            // Do not kill the schedule on one bad tick.
            log.error("Referral signal retention sweep failed; will retry on the next tick", e);
        }
    }
}
