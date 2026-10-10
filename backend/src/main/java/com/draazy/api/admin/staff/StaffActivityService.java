package com.draazy.api.admin.staff;

import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only: staff activity is whatever {@code audit_log} already holds, so completeness does not depend on
 * each frontend page remembering to log. */
@Service
public class StaffActivityService {

    /** Capped because the page ranks by volume, so anyone past the cap is not near the top;
     * the paged, unbounded feed is where "what did this person do" is answered. */
    private static final int LEADERBOARD_CAP = 24;

    private final StaffActivityRepository repository;

    StaffActivityService(StaffActivityRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public Page<StaffActivityEntry> feed(StaffActivityFilter filter, Pageable pageable, boolean withMetadata) {
        long total = repository.total(filter);
        if (total == 0) {
            return new PageImpl<>(List.of(), pageable, 0);
        }
        List<StaffActivityEntry> rows = repository.feed(
                filter, pageable.getPageSize(), (int) pageable.getOffset(), withMetadata);
        return new PageImpl<>(rows, pageable, total);
    }

    /** Six round trips, deliberately: each aggregate is answered from an index, and folding the window in memory
     * would be browser-side arithmetic moved one tier down. */
    @Transactional(readOnly = true)
    public StaffActivitySummary summary(StaffActivityFilter filter) {
        return new StaffActivitySummary(
                repository.total(filter),
                repository.distinctActors(filter),
                repository.byEntity(filter),
                repository.actions(filter),
                repository.leaderboard(filter, LEADERBOARD_CAP));
    }
}
