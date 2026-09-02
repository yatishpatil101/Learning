package com.draazy.api.engagement.demand;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DemandSignalRepository extends JpaRepository<DemandSignal, UUID> {

    /**
     * Demand per locality over a window, split by kind, in one round trip.
     *
     * <p><strong>Why aggregated in SQL rather than in the service.</strong> The rows are unbounded —
     * every search by every visitor lands here — so the alternative is fetching a window of raw
     * events into memory to count them. That is the mistake the browser version made in miniature:
     * it worked while the array was one person's session and would not have survived being real.
     * Postgres counts rows for a living.
     *
     * <p><strong>Why three counts rather than one grouped by kind.</strong> The report needs one row
     * per locality with the kinds side by side; grouping by {@code (locality, kind)} returns up to
     * three rows per locality and pushes the pivot into Java, where it becomes a map of maps that
     * every caller has to reassemble. Filtered aggregates give the reader the shape it wants.
     *
     * <p><strong>Why null localities survive.</strong> {@code coalesce} would fold "somewhere in the
     * city" into a locality named "Unknown" and let it sort alongside real ones. They are counted
     * under a null slug and the caller decides how to present them — a supply gap cannot be computed
     * for a place nobody named, so the report must be able to tell the two apart.
     *
     * @param since inclusive lower bound; the caller owns the window
     */
    @Query(value = """
            select locality_slug                                       as localitySlug,
                   count(*) filter (where kind = 'search')             as searches,
                   count(*) filter (where kind = 'alert')              as alerts,
                   count(*) filter (where kind = 'view')               as views
            from demand_signals
            where created_at >= :since
            group by locality_slug""", nativeQuery = true)
    List<DemandByLocality> aggregateSince(@Param("since") Instant since);

    /**
     * People who searched the same locality at least {@value #REPEAT_THRESHOLD} times in the window.
     *
     * <p><strong>Why this is a second query.</strong> Counting distinct users who cross a threshold
     * is a group-within-a-group; folded into {@link #aggregateSince} it becomes a correlated
     * subquery evaluated once per locality. Two simple statements read better and scan better than
     * one clever one.
     *
     * <p><strong>Why signed-in only, and why that is a correction.</strong> The browser version
     * counted repeat seekers too, but it stamped every anonymous search with the literal user id
     * {@code 'anon'} — so three searches by three different strangers in the same locality reported
     * one "hot" seeker, and thirty reported one as well. This counts only sessions that can be told
     * apart, which is a smaller number and the only honest one: without an account there is nothing
     * that distinguishes one person searching three times from three people searching once.
     *
     * @param since inclusive lower bound; the caller owns the window
     */
    @Query(value = """
            select locality_slug as localitySlug, count(*) as seekers
            from (
                select locality_slug, user_id
                from demand_signals
                where created_at >= :since
                  and kind = 'search'
                  and user_id is not null
                  and locality_slug is not null
                group by locality_slug, user_id
                having count(*) >= 3
            ) repeat_searchers
            group by locality_slug""", nativeQuery = true)
    List<RepeatSeekersByLocality> repeatSeekersSince(@Param("since") Instant since);

    /** The threshold above, named so the Javadoc and the SQL cannot drift apart silently. */
    int REPEAT_THRESHOLD = 3;

    /**
     * Projection for {@link #aggregateSince}. An interface rather than a record because Spring Data
     * binds native-query columns by accessor name, and the names above are aliased to match.
     */
    interface DemandByLocality {
        String getLocalitySlug();

        long getSearches();

        long getAlerts();

        long getViews();
    }

    /** Projection for {@link #repeatSeekersSince}. Never carries a null slug — the query excludes it. */
    interface RepeatSeekersByLocality {
        String getLocalitySlug();

        long getSeekers();
    }
}
