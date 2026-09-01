package com.punenest.api.engagement.pageview;

import com.punenest.api.common.PlatformTime;
import java.time.Instant;
import java.time.LocalDate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turns raw {@link PageView} rows into the identity-free daily aggregates every report reads.
 *
 * <p><strong>Why anything reads the rollup rather than the raw table.</strong> The range picker in
 * the analytics console offers 30, 90 and 180 days, and raw views are kept for ninety — so a report
 * served from raw data would return half a window at its widest setting, and would do it silently.
 * The chart would render, the axis would still say 180 days, and the first three months would just
 * be flat. Reading exclusively from the rollup means the retention sweep and an erasure request can
 * never move a number that has already been reported.
 *
 * <p><strong>Why it recomputes rather than appends.</strong> The browser batches, so views arrive
 * minutes after they happened and a day is not finished when the clock says it is. An append-only
 * job would have to decide when a day is closed and would be wrong about it. Recomputing a short
 * trailing window from the raw rows makes the job idempotent — running it twice, or after a failed
 * run, produces exactly the same aggregates — and lets late events correct themselves.
 *
 * <p><strong>Why the window is two days and not one.</strong> One day is not enough at a boundary:
 * a view at 23:58 IST that flushes at 00:01 belongs to yesterday, and a job that only ever
 * recomputes today would never go back for it. Two days covers every late arrival the client can
 * produce — its flush interval is fifteen seconds and its backdate clamp is six hours — with the
 * rest of the day as margin. It is deliberately not larger: the cost is re-reading raw rows, and
 * widening it to catch a hypothetical arrival that the client cannot generate would trade real work
 * every hour for an event that never happens.
 *
 * <p>Split from {@link PageViewRollupJob} for the same reason {@link PageViewRetention} is split
 * from its sweep: the computation is exercised directly at a window a test chooses, and the trigger
 * has nothing in it worth testing.
 */
@Component
public class PageViewRollup {

    private static final Logger log = LoggerFactory.getLogger(PageViewRollup.class);

    /**
     * How many IST days back the job recomputes, counting today.
     *
     * <p>Public so a test asserts against the real window rather than a number retyped beside it.
     */
    public static final int RECOMPUTE_DAYS = 2;

    private final PageViewRepository repository;

    public PageViewRollup(PageViewRepository repository) {
        this.repository = repository;
    }

    /**
     * Recompute all three aggregates for every IST day the window touches.
     *
     * <p>Clear-then-insert, all three tables, one transaction. The clear and the insert must not be
     * separable: between them the aggregates are empty for those days, and a reader that saw that
     * state would draw a chart showing the platform received no traffic today. Inside one
     * transaction nobody can observe it, and a failure half way leaves the previous rollup intact
     * rather than a hole.
     *
     * @param fromInstant start of the earliest IST day to recompute
     * @param toInstant   exclusive upper bound, normally now
     * @return how many aggregate rows were written across all three tables
     */
    @Transactional
    public int rollUpBetween(Instant fromInstant, Instant toInstant) {
        repository.clearDailyFrom(fromInstant);
        repository.clearDailyPathsFrom(fromInstant);
        repository.clearDailyReferrersFrom(fromInstant);
        int days = repository.rebuildDaily(fromInstant, toInstant);
        int paths = repository.rebuildDailyPaths(fromInstant, toInstant);
        int referrers = repository.rebuildDailyReferrers(fromInstant, toInstant);
        log.debug("Rolled up page views from {} to {}: {} day rows, {} path rows, {} referrer rows",
                fromInstant, toInstant, days, paths, referrers);
        return days + paths + referrers;
    }

    /**
     * Recompute the trailing {@link #RECOMPUTE_DAYS} IST days. What the scheduled job calls.
     *
     * <p><strong>Annotated in its own right, and it must stay that way.</strong> This calls
     * {@link #rollUpBetween} on {@code this}, so the call never crosses the transactional proxy and
     * does not inherit that method's transaction. Without {@code @Transactional} here the modifying
     * queries throw {@code No active transaction} on every tick — invisibly, because the job
     * swallows exceptions to stay alive and a test calling the inner method directly still passes.
     * {@code ReferralSignalRetention} shipped with exactly this bug and every daily tick failed
     * silently from the day it was written.
     */
    @Transactional
    public int rollUpNow() {
        Instant now = Instant.now();
        LocalDate from = LocalDate.ofInstant(now, PlatformTime.IST).minusDays(RECOMPUTE_DAYS - 1L);
        return rollUpBetween(from.atStartOfDay(PlatformTime.IST).toInstant(), now);
    }
}
