package com.punenest.api.engagement.search;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * D7: periodic recomputation of saved-search {@code new_count}.
 *
 * <p>Kept as a trigger class so the matching/counting logic remains directly testable on
 * {@link SavedSearchService#recomputeNewCounts(Instant)} without wall-clock timing in tests.
 */
@Component
@ConditionalOnProperty(name = "punenest.engagement.saved-search-sweep.enabled",
        havingValue = "true", matchIfMissing = true)
public class SavedSearchNewCountSweep {

    private static final Logger log = LoggerFactory.getLogger(SavedSearchNewCountSweep.class);

    private static final long EVERY_THIRTY_MINUTES_MS = 30L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    private final SavedSearchService savedSearches;

    public SavedSearchNewCountSweep(SavedSearchService savedSearches) {
        this.savedSearches = savedSearches;
    }

    @Scheduled(fixedDelay = EVERY_THIRTY_MINUTES_MS, initialDelay = AFTER_STARTUP_MS)
    public void recomputeNewCounts() {
        try {
            long updated = savedSearches.recomputeNewCounts(Instant.now());
            if (updated > 0) {
                log.info("Saved-search sweep recomputed {} alert row(s)", updated);
            }
        } catch (RuntimeException e) {
            log.error("Saved-search sweep failed; will retry on the next tick", e);
        }
    }
}
