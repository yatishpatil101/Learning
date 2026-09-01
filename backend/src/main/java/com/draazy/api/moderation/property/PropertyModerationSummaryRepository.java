package com.draazy.api.moderation.property;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * The moderation summary's one query.
 *
 * <p>Native SQL, and a single statement rather than seven {@code count(*)} calls. The counters
 * describe one moment; issuing them separately would let a moderator's own approval land between
 * the second and the third, producing a strip whose numbers do not add up and which reports a
 * listing as both pending and approved. {@code filter (where ...)} gives all seven from one scan.
 *
 * <p>{@code archived} is the only counter outside the {@code not archived} floor, because an
 * archived listing is not part of the platform's live inventory and counting it in {@code total}
 * would make the tiles disagree with the table beneath them.
 */
@Repository
class PropertyModerationSummaryRepository {

    /**
     * {@code pending} is the only spelling of the unreviewed state. The console pairs it with
     * {@code 'Under Review'} everywhere it tests for a waiting listing, but that value cannot occur:
     * {@code properties_status_check} allows exactly
     * {@code pending|approved|rejected|flagged|archived|sold|rented}, so the database refuses the
     * row outright. It was a mock-side spelling, and counting it here would have been a query
     * branch that no data can reach.
     *
     * <p>{@code sold} and {@code rented} are deliberately in {@code total} and on no tile of their
     * own. They are live listings with a closed deal — real inventory, but not work waiting for
     * anybody, so a moderation strip that broke them out would be offering a queue that is never
     * drained.
     *
     * <p>{@code recheck} counts {@code recheck_requested_at is not null}, which is the same
     * predicate {@code PropertySpecs.adminSearch} uses for {@code recheck=true}. There is no
     * {@code recheck_pending} column — the timestamp is the flag, so that the queue's age and its
     * existence can never disagree.
     */
    private static final String SUMMARY = """
            select
              count(*) filter (where not archived)                                     as total,
              count(*) filter (where not archived and status = 'approved')             as approved,
              count(*) filter (where not archived and status = 'pending')              as pending,
              count(*) filter (where not archived and status = 'flagged')              as flagged,
              count(*) filter (where not archived and featured)                        as featured,
              count(*) filter (where not archived and recheck_requested_at is not null) as recheck,
              count(*) filter (where archived)                                         as archived
            from properties
            """;

    private final EntityManager em;

    PropertyModerationSummaryRepository(EntityManager em) {
        this.em = em;
    }

    PropertyModerationSummary summary() {
        Object[] row = (Object[]) em.createNativeQuery(SUMMARY).getSingleResult();
        return new PropertyModerationSummary(
                at(row, 0), at(row, 1), at(row, 2), at(row, 3), at(row, 4), at(row, 5), at(row, 6));
    }

    /**
     * Postgres answers {@code count(*)} as {@code bigint}, which the JDBC driver may hand back as
     * {@link Long} or, on some paths, {@link java.math.BigInteger}. Reading through {@link Number}
     * rather than casting keeps the mapping from depending on which.
     */
    private static long at(Object[] row, int index) {
        Object value = row[index];
        return value instanceof Number n ? n.longValue() : 0L;
    }
}
