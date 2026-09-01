package com.punenest.api.catalog.listing;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * D219: re-runs the duplicate probe over recent listings, catching the pair that raced.
 *
 * <p>{@link ListingDuplicateProbe#flag} runs inside the transaction that writes the listing, so
 * under {@code READ COMMITTED} it cannot see a sibling submission that has not committed yet. Two
 * identical listings posted in the same second are therefore each invisible to the other's check —
 * and that is the shape the abuse actually takes, since a broker uploading one flat twice does it
 * from a script rather than by hand a day apart. The synchronous probe catches the careless; this
 * catches the deliberate, a few minutes later.
 *
 * <p>A trigger class with no logic of its own, matching the other sweeps in this codebase: the
 * behaviour lives on {@link ListingDuplicateProbe#resweepRecent} where a test can call it with an
 * explicit instant instead of waiting on a wall clock.
 */
@Component
@ConditionalOnProperty(name = "punenest.catalog.duplicate-sweep.enabled",
        havingValue = "true", matchIfMissing = true)
public class ListingDuplicateSweep {

    private static final Logger log = LoggerFactory.getLogger(ListingDuplicateSweep.class);

    private static final long EVERY_TEN_MINUTES_MS = 10L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 2L * 60L * 1000L;

    /**
     * Twice the period, so every listing is read by two consecutive ticks.
     *
     * <p>A window equal to the period would leave a permanent hole in coverage the first time a tick
     * dies mid-run or a deploy lands between two of them, and the listings lost would be exactly the
     * ones created during the outage — with nothing to say they were skipped. The overlap costs one
     * more indexed range scan over a few minutes of creates.
     */
    private static final Duration WINDOW = Duration.ofMinutes(20);

    /**
     * A ceiling, not a page size — there is no second page and the sweep does not resume.
     *
     * <p>Twenty minutes of creates is a couple of dozen rows on any traffic this platform has seen,
     * so hitting this bound means something is wrong (a bulk import, a scripted flood) and the right
     * response is a bounded amount of work plus a warning, rather than a sweep that quietly grows
     * until it holds a transaction open long enough to matter.
     *
     * <p>The query is ordered oldest-first, so an overflow is the <em>newest</em> rows — which the
     * next tick still has in its window and will pick up. Without that ordering the ceiling would
     * silently drop an arbitrary and stable subset instead, which is why the ordering is asserted in
     * the repository rather than left to the planner.
     */
    private static final int MAX_PER_TICK = 500;

    private final ListingDuplicateProbe probe;

    public ListingDuplicateSweep(ListingDuplicateProbe probe) {
        this.probe = probe;
    }

    @Scheduled(fixedDelay = EVERY_TEN_MINUTES_MS, initialDelay = AFTER_STARTUP_MS)
    public void resweepRecentListings() {
        try {
            int scanned = probe.resweepRecent(Instant.now().minus(WINDOW), MAX_PER_TICK);
            if (scanned >= MAX_PER_TICK) {
                log.warn("Duplicate sweep hit its per-tick ceiling of {} listing(s); listings created"
                        + " in the last {} minutes may not all have been re-checked",
                        MAX_PER_TICK, WINDOW.toMinutes());
            }
        } catch (RuntimeException e) {
            log.error("Duplicate sweep failed; will retry on the next tick", e);
        }
    }
}
