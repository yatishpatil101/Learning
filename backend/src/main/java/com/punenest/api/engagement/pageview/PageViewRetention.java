package com.punenest.api.engagement.pageview;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The ninety-day promise on raw {@link PageView} rows.
 *
 * <p><strong>Why raw data expires and the aggregates do not.</strong> A raw row carries a session id
 * and sometimes a user id, so a table of them is a browsing record and its value decays fast — after
 * a quarter, nothing any report asks needs the individual rows, only the daily totals derived from
 * them. Those totals name nobody and are kept indefinitely, because year-on-year comparison is the
 * whole point of collecting traffic in the first place. Expiring the raw grain therefore costs no
 * reporting capability at all, which is what makes ninety days an easy number rather than a
 * compromise.
 *
 * <p>Reports read only the rollup, so a sweep can never change an answer — see
 * {@code V14__DDL_analytics.sql} (the page-view telemetry section, added in the old V96) for why
 * that separation is load-bearing rather than tidy.
 *
 * <p><strong>Split from {@link PageViewRetentionSweep} deliberately.</strong> The expiry is
 * exercised directly at a cutoff a test chooses, rather than by waiting on a wall-clock timer. Same
 * shape as {@code ReferralSignalRetention}.
 */
@Component
public class PageViewRetention {

    private static final Logger log = LoggerFactory.getLogger(PageViewRetention.class);

    /**
     * How long a raw page view is kept.
     *
     * <p>Public so a test can prove the expiry against the real window rather than against a number
     * retyped beside it — a private constant and a test constant drift apart the first time one is
     * changed, and the test goes on passing.
     */
    public static final Duration RETENTION = Duration.ofDays(90);

    private final PageViewRepository repository;

    public PageViewRetention(PageViewRepository repository) {
        this.repository = repository;
    }

    /**
     * Delete raw page views recorded before {@code cutoff}.
     *
     * @return how many rows went
     */
    @Transactional
    public int expirePageViewsOlderThan(Instant cutoff) {
        int removed = repository.deleteOlderThan(cutoff);
        if (removed > 0) {
            log.info("Expired {} raw page views recorded before {}", removed, cutoff);
        }
        return removed;
    }

    /**
     * Delete everything older than {@link #RETENTION}. What the scheduled sweep calls.
     *
     * <p><strong>Annotated in its own right, and it must stay that way.</strong> This method calls
     * {@link #expirePageViewsOlderThan} on {@code this}, so the call never crosses the transactional
     * proxy and does not inherit that method's transaction. Without {@code @Transactional} here, the
     * delete throws {@code InvalidDataAccessApiUsageException: No active transaction} on every
     * scheduled tick — and does it invisibly, because the sweep swallows exceptions to stay alive
     * and a unit test that calls the inner method directly goes on passing. That is not a
     * hypothetical: it is exactly what happened to {@code ReferralSignalRetention}, where every
     * daily tick failed silently from the day it was written until the annotation was added.
     */
    @Transactional
    public int expireNow() {
        return expirePageViewsOlderThan(Instant.now().minus(RETENTION));
    }
}
