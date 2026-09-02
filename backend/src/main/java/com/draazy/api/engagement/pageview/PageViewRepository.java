package com.draazy.api.engagement.pageview;

import java.time.Instant;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * Raw page views. Written by {@link PageViewService}, pruned by {@link PageViewRetention}, and
 * pseudonymised by an erasure request.
 *
 * <p><strong>There is deliberately no read here that returns rows.</strong> Every report goes
 * through the daily aggregates, so nothing in the application ever holds a list of one person's page
 * views in memory. That is not tidiness — a repository method returning {@code List<PageView>} by
 * session or by user is the exact affordance that turns an aggregate-only table into a surveillance
 * one, and it is easier to not write it than to keep explaining why nobody should call it.
 */
@Repository
public interface PageViewRepository extends JpaRepository<PageView, UUID> {

    /**
     * Delete everything collected before {@code cutoff}. The ninety-day retention promise.
     *
     * <p>Served by {@code page_views_occurred_idx}.
     */
    @Modifying
    @Query("delete from PageView p where p.occurredAt < :cutoff")
    int deleteOlderThan(@Param("cutoff") Instant cutoff);

    /*
     * There is deliberately no pseudonymise-by-user method here, though erasure does exactly that.
     *
     * ErasureService nulls page_views.user_id with its own native statement, alongside the forty
     * or so other tables it clears, because it collects a row count per table into the record the
     * data subject is shown. Injecting one repository for one table would make page_views the odd
     * entry in a list whose uniformity is what keeps it auditable at a glance. A method here would
     * therefore be a second, uncalled statement of the same rule -- and the failure mode of two
     * definitions is that someone changes the one nobody runs. The behaviour is proved end to end
     * by ErasureCoverageTest, which reads the rows back rather than trusting the count.
     */

    // ---------------------------------------------------------------------------------------------
    // Rollup. Driven by PageViewRollup; see that class for why the window is what it is.
    //
    // These four statements are native and stay native. The aggregation is FILTER clauses, ordered
    // array_agg and a day cut in a named timezone -- expressed in JPQL it would be several round
    // trips and a lot of Java doing what one GROUP BY does, over the one table that grows without
    // bound. It is also the only place in the application allowed to read raw page views at all, and
    // it never returns them: rows go from page_views into the aggregates without passing through the
    // application, which is the same privacy boundary the missing finders above are protecting.
    // ---------------------------------------------------------------------------------------------

    /**
     * Clear day-grain rows from {@code fromInstant}'s IST day onward, so the insert that follows is
     * a recompute rather than an accumulate.
     *
     * <p>Delete-then-insert rather than {@code ON CONFLICT DO UPDATE} deliberately. An upsert only
     * corrects days that still produce a row, so a day whose raw views all expired or were rolled
     * back would keep its old totals forever — the number would be wrong and nothing would ever
     * revisit it. Deleting first makes "no raw data" and "no aggregate row" the same state, which is
     * what makes the job safe to run twice.
     */
    @Modifying
    @Query(nativeQuery = true, value = """
            delete from page_view_daily
             where day >= cast(:fromInstant at time zone 'Asia/Kolkata' as date)
            """)
    int clearDailyFrom(@Param("fromInstant") Instant fromInstant);

    /** The page-grain half of {@link #clearDailyFrom}, for the same reason. */
    @Modifying
    @Query(nativeQuery = true, value = """
            delete from page_view_daily_paths
             where day >= cast(:fromInstant at time zone 'Asia/Kolkata' as date)
            """)
    int clearDailyPathsFrom(@Param("fromInstant") Instant fromInstant);

    /**
     * Recompute day-grain traffic for every IST day touched by the window.
     *
     * <p><strong>The unit is a session-day, not a session.</strong> A session running past midnight
     * counts once on each side, with its views split where the day breaks. The alternative —
     * attributing a whole session to the day it started — reads more natural and quietly makes every
     * day depend on the one before it, so recomputing Tuesday would mean re-reading Monday's rows to
     * find sessions that spilled over. Cutting at midnight instead makes each day computable from
     * its own rows alone, which is the property that lets the job recompute a short trailing window
     * and stop.
     *
     * <p>Device is the session's <em>first</em> view, not its most common: a viewer who rotates a
     * tablet or drags a window is one session on the device they arrived with, and picking the mode
     * would break ties arbitrarily while looking authoritative.
     *
     * <p>Duration is last view minus first, so a one-page session is zero — which is correct and is
     * why {@code bounced_sessions} is counted separately rather than inferred from a zero duration.
     */
    @Modifying
    @Query(nativeQuery = true, value = """
            insert into page_view_daily (
                    day, sessions, anon_sessions, signed_in_sessions, pageviews,
                    bounced_sessions, duration_seconds_total,
                    mobile_sessions, tablet_sessions, desktop_sessions, rolled_up_at)
            with ist as (
                select session_id,
                       user_id,
                       device,
                       occurred_at,
                       cast(occurred_at at time zone 'Asia/Kolkata' as date) as day
                  from page_views
                 where occurred_at >= :fromInstant
                   and occurred_at < :toInstant
            ),
            sess as (
                select day,
                       session_id,
                       count(*) as views,
                       bool_or(user_id is not null) as signed_in,
                       extract(epoch from max(occurred_at) - min(occurred_at)) as duration_seconds,
                       (array_agg(device order by occurred_at))[1] as entry_device
                  from ist
                 group by day, session_id
            )
            select day,
                   count(*),
                   count(*) filter (where not signed_in),
                   count(*) filter (where signed_in),
                   sum(views),
                   count(*) filter (where views = 1),
                   cast(coalesce(sum(duration_seconds), 0) as bigint),
                   count(*) filter (where entry_device = 'mobile'),
                   count(*) filter (where entry_device = 'tablet'),
                   count(*) filter (where entry_device = 'desktop'),
                   now()
              from sess
             group by day
            """)
    int rebuildDaily(@Param("fromInstant") Instant fromInstant, @Param("toInstant") Instant toInstant);

    /**
     * Recompute page-grain traffic for every IST day touched by the window.
     *
     * <p>{@code exits} counts sessions whose last view <em>of that day</em> was this path, which is
     * the one measure here that is not a plain count of rows: it needs the session's ordering, and
     * it is what the drop-off funnel is built from. A left join rather than an inner one, because a
     * path can be viewed on a day without ever being the page anybody left from — inner-joining
     * would silently drop those paths from the top-pages chart entirely.
     */
    @Modifying
    @Query(nativeQuery = true, value = """
            insert into page_view_daily_paths (day, path, pageviews, anon_pageviews, exits)
            with ist as (
                select session_id,
                       user_id,
                       path,
                       occurred_at,
                       cast(occurred_at at time zone 'Asia/Kolkata' as date) as day
                  from page_views
                 where occurred_at >= :fromInstant
                   and occurred_at < :toInstant
            ),
            viewed as (
                select day,
                       path,
                       count(*) as pageviews,
                       count(*) filter (where user_id is null) as anon_pageviews
                  from ist
                 group by day, path
            ),
            last_of_session as (
                select day,
                       (array_agg(path order by occurred_at desc))[1] as path
                  from ist
                 group by day, session_id
            ),
            exited as (
                select day, path, count(*) as exits
                  from last_of_session
                 group by day, path
            )
            select v.day, v.path, v.pageviews, v.anon_pageviews, coalesce(e.exits, 0)
              from viewed v
              left join exited e on e.day = v.day and e.path = v.path
            """)
    int rebuildDailyPaths(@Param("fromInstant") Instant fromInstant,
            @Param("toInstant") Instant toInstant);

    /** The referrer-grain half of {@link #clearDailyFrom}, for the same reason. */
    @Modifying
    @Query(nativeQuery = true, value = """
            delete from page_view_daily_referrers
             where day >= cast(:fromInstant at time zone 'Asia/Kolkata' as date)
            """)
    int clearDailyReferrersFrom(@Param("fromInstant") Instant fromInstant);

    /**
     * Recompute referrer-grain traffic for every IST day touched by the window.
     *
     * <p>Counts <em>sessions</em>, not views, and attributes each to the referrer of its
     * <em>first</em> view — the same entry rule {@link #rebuildDaily} applies to device, and for the
     * same reason. A visitor came from one place; the referrer on a later view in the same session
     * is an internal navigation the browser happened to report, so counting rows would credit the
     * source with the reading the visitor went on to do and then present that as reach, because the
     * chart it feeds is a share of the total.
     *
     * <p>A null host becomes the empty string rather than staying null, because the column is half
     * of the primary key. That is not a workaround for the constraint: "direct" is a real answer the
     * chart displays, covering a typed address, a bookmark and a browser that withheld the header,
     * which are not distinguishable from one another and which no report claims to distinguish.
     */
    @Modifying
    @Query(nativeQuery = true, value = """
            insert into page_view_daily_referrers (day, referrer_host, sessions)
            with ist as (
                select session_id,
                       referrer_host,
                       occurred_at,
                       cast(occurred_at at time zone 'Asia/Kolkata' as date) as day
                  from page_views
                 where occurred_at >= :fromInstant
                   and occurred_at < :toInstant
            ),
            sess as (
                select day,
                       session_id,
                       (array_agg(coalesce(referrer_host, '') order by occurred_at))[1] as entry_host
                  from ist
                 group by day, session_id
            )
            select day, entry_host, count(*)
              from sess
             group by day, entry_host
            """)
    int rebuildDailyReferrers(@Param("fromInstant") Instant fromInstant,
            @Param("toInstant") Instant toInstant);
}
