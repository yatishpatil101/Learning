package com.draazy.api.admin.staff;

import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The read model behind the Staff Activity console.
 *
 * <p>There is no writing here and there never will be. Staff activity is not a thing the platform
 * records on purpose; it is what {@code audit_log} already contains, read from the other end. The
 * mock this replaces had a {@code logStaffActivity} call sprinkled through the frontend at each
 * point somebody remembered to add one, which meant the feed's completeness was a property of how
 * attentive the last person to touch a page had been.
 */
@Service
public class StaffActivityService {

    /**
     * The leaderboard is capped because it is a leaderboard. A back office with two hundred staff
     * does not need two hundred cards, and the page ranks by volume, so anyone past the cap is by
     * definition not near the top. The feed below it is paged and unbounded, which is where the
     * question "what did this specific person do" is actually answered.
     */
    private static final int LEADERBOARD_CAP = 24;

    private final StaffActivityRepository repository;

    StaffActivityService(StaffActivityRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public Page<StaffActivityEntry> feed(StaffActivityFilter filter, Pageable pageable) {
        long total = repository.total(filter);
        if (total == 0) {
            return new PageImpl<>(List.of(), pageable, 0);
        }
        List<StaffActivityEntry> rows = repository.feed(
                filter, pageable.getPageSize(), (int) pageable.getOffset());
        return new PageImpl<>(rows, pageable, total);
    }

    /**
     * Four counts and two lists over the same window. Six round trips to the database rather than
     * one, and deliberately: each is an aggregate the database can answer from an index, and the
     * alternative — pulling the window into memory and folding it six ways — is the browser-side
     * arithmetic this whole change exists to remove, moved one tier down.
     */
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
