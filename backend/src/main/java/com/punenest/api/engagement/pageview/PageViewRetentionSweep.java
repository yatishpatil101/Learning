package com.punenest.api.engagement.pageview;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs {@link PageViewRetention} on a timer. Nothing else.
 *
 * <p><strong>Why this is a separate class from the policy.</strong> So the expiry itself is testable
 * directly, at a cutoff the test chooses, rather than by waiting on a wall-clock timer. The trigger
 * has no logic worth testing and the policy has no schedule worth waiting for.
 *
 * <p><strong>Why it is switchable off.</strong> A background thread deleting rows outside a test's
 * transaction would fail whichever test happened to be asserting on freshly recorded telemetry, and
 * it would fail it intermittently — the worst possible failure to debug, because the test that
 * breaks is chosen by timing rather than by the change. Off in the test profile, on everywhere else,
 * including when the property is absent so a forgotten config does not silently disable retention in
 * production.
 */
@Component
@ConditionalOnProperty(name = "punenest.analytics.page-view-retention.enabled",
        havingValue = "true", matchIfMissing = true)
public class PageViewRetentionSweep {

    private static final Logger log = LoggerFactory.getLogger(PageViewRetentionSweep.class);

    private static final long EVERY_DAY_MS = 24L * 60L * 60L * 1000L;

    /**
     * Deliberately not zero. A deploy that restarts several instances would otherwise have every one
     * of them start a bulk delete during the window when the application is least able to absorb it,
     * and a retention sweep is the least urgent thing running — a row that is ninety days and ten
     * minutes old is not a problem.
     */
    private static final long AFTER_STARTUP_MS = 10L * 60L * 1000L;

    private final PageViewRetention retention;

    public PageViewRetentionSweep(PageViewRetention retention) {
        this.retention = retention;
    }

    /** Expire raw page views past {@link PageViewRetention#RETENTION}. */
    @Scheduled(fixedDelay = EVERY_DAY_MS, initialDelay = AFTER_STARTUP_MS)
    public void expirePageViews() {
        try {
            retention.expireNow();
        } catch (RuntimeException e) {
            // Swallowed so one bad tick does not kill the scheduler and silently end retention
            // altogether. Logged at error precisely because it is swallowed -- this line is the
            // only evidence that the promise is not being kept.
            log.error("Page view retention sweep failed; will retry on the next tick", e);
        }
    }
}
