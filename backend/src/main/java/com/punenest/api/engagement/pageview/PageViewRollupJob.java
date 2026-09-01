package com.punenest.api.engagement.pageview;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs {@link PageViewRollup} on a timer. Nothing else.
 *
 * <p><strong>Why hourly.</strong> The aggregates are what the console reads, so the interval is how
 * stale the newest bar on a chart can be. Daily would mean an admin looking at traffic at four in
 * the afternoon sees nothing at all for today, which reads as an outage rather than as a schedule.
 * More often than hourly buys nothing a reader would notice and re-reads the same raw rows for it.
 *
 * <p><strong>Why it is switchable off.</strong> Same reason as {@link PageViewRetentionSweep}: a
 * background thread rewriting aggregate rows outside a test's transaction would fail whichever test
 * happened to be asserting on them, intermittently, with the failing test chosen by timing rather
 * than by the change. Off in the test profile, on everywhere else — including when the property is
 * absent, so a forgotten config cannot silently leave every analytics tab empty in production.
 */
@Component
@ConditionalOnProperty(name = "punenest.analytics.page-view-rollup.enabled",
        havingValue = "true", matchIfMissing = true)
public class PageViewRollupJob {

    private static final Logger log = LoggerFactory.getLogger(PageViewRollupJob.class);

    private static final long EVERY_HOUR_MS = 60L * 60L * 1000L;

    /**
     * Short, unlike the retention sweep's. Rolling up is cheap — it reads a two-day window — and
     * until it has run once after a deploy the newest day on every chart is missing, so the useful
     * default is to catch up promptly rather than to stay out of the way.
     */
    private static final long AFTER_STARTUP_MS = 60L * 1000L;

    private final PageViewRollup rollup;

    public PageViewRollupJob(PageViewRollup rollup) {
        this.rollup = rollup;
    }

    /** Recompute the trailing {@link PageViewRollup#RECOMPUTE_DAYS} IST days. */
    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void rollUpPageViews() {
        try {
            rollup.rollUpNow();
        } catch (RuntimeException e) {
            // Swallowed so one bad tick does not kill the scheduler and stop the rollup for good.
            // Logged at error precisely because it is swallowed: the symptom otherwise is charts
            // that quietly stop moving, which nobody reports as a fault for weeks.
            log.error("Page view rollup failed; will retry on the next tick", e);
        }
    }
}
