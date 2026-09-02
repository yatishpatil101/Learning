package com.draazy.api.engagement.pageview;

import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Repository;

/**
 * Every read the analytics console performs against page-view data.
 *
 * <p><strong>It touches the three daily aggregates and never {@code page_views}.</strong> That is
 * the whole reason this class is separate from {@link PageViewRepository}, which owns the raw table
 * and deliberately exposes no finder at all. Keeping both in one package means the rule — writes and
 * the rollup may read raw rows, reports may not — is reviewable by reading one directory, rather
 * than being a convention somebody has to already know.
 *
 * <p>Two consequences follow from reading aggregates, and both are features:
 *
 * <ul>
 *   <li>Nothing here can return a person. The aggregate tables have no identity column, so there is
 *       no query that could leak one even if somebody wrote it carelessly.
 *   <li>Reported figures are stable. The ninety-day sweep deletes raw rows and an erasure request
 *       blanks a {@code user_id}; neither can move a number an operator has already read, because
 *       the aggregates were computed before either ran and are not recomputed that far back.
 * </ul>
 *
 * <p><strong>Native SQL, following {@code AdminMetricsRepository}.</strong> The aggregates have no
 * JPA entity — nothing in the application creates or edits one, the rollup writes them with
 * {@code INSERT … SELECT}, and mapping them would create an affordance for exactly the row-by-row
 * access this design excludes. The cost is that a column rename breaks this at runtime rather than
 * at compile time, which is why every query here has a test.
 *
 * <p>Windows are half-open {@code [from, to)} on IST days. The rollup cut the rows on that calendar,
 * so the reader must bound them on the same one; a window in any other zone would slice partial days
 * off both ends and report them as whole.
 */
@Repository
public class PageViewReportRepository {

    private final EntityManager em;

    public PageViewReportRepository(EntityManager em) {
        this.em = em;
    }

    /**
     * Day-grain traffic, oldest first, one row per day that saw any traffic.
     *
     * <p><strong>Days with no traffic are absent, not zero.</strong> They are genuinely missing —
     * the rollup writes no row for a day nobody visited — and filling them in belongs to the caller,
     * which knows the window it asked for. See {@code AdminPageViewAnalyticsService}, which does
     * exactly that, because a chart with holes in it draws a misleading line between the points it
     * does have.
     *
     * @return {@code [day, sessions, anonSessions, signedInSessions, pageviews, bouncedSessions,
     *         durationSecondsTotal, mobileSessions, tabletSessions, desktopSessions]}
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> dailyTraffic(LocalDate from, LocalDate to) {
        return em.createNativeQuery("""
                select day, sessions, anon_sessions, signed_in_sessions, pageviews,
                       bounced_sessions, duration_seconds_total,
                       mobile_sessions, tablet_sessions, desktop_sessions
                  from page_view_daily
                 where day >= :from and day < :to
                 order by day
                """)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
    }

    /**
     * The busiest paths in the window, most-viewed first.
     *
     * <p>Ranked and capped in SQL rather than in Java. The alternative — read every path for a
     * hundred and eighty days and sort in memory — grows with how many distinct routes the site has
     * ever served, which is the number that only ever goes up.
     *
     * @return {@code [path, pageviews, anonPageviews, exits]}
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> topPaths(LocalDate from, LocalDate to, int limit) {
        return em.createNativeQuery("""
                select path,
                       sum(pageviews) as pageviews,
                       sum(anon_pageviews) as anon_pageviews,
                       sum(exits) as exits
                  from page_view_daily_paths
                 where day >= :from and day < :to
                 group by path
                 order by pageviews desc, path
                 limit :limit
                """)
                .setParameter("from", from)
                .setParameter("to", to)
                .setParameter("limit", limit)
                .getResultList();
    }

    /**
     * The paths visitors most often left from, most exits first.
     *
     * <p>A separate query from {@link #topPaths} rather than a re-sort of it, because the two
     * answer different questions and the top page by views is frequently not the top page by exits.
     * Taking the busiest pages and re-ranking them by exits would quietly exclude a page that
     * everybody leaves from precisely because few people reach it — which is the page the drop-off
     * report exists to surface.
     *
     * @return {@code [path, exits]}
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> topExitPaths(LocalDate from, LocalDate to, int limit) {
        return em.createNativeQuery("""
                select path, sum(exits) as exits
                  from page_view_daily_paths
                 where day >= :from and day < :to
                 group by path
                having sum(exits) > 0
                 order by exits desc, path
                 limit :limit
                """)
                .setParameter("from", from)
                .setParameter("to", to)
                .setParameter("limit", limit)
                .getResultList();
    }

    /**
     * Sessions per referring host in the window, largest first.
     *
     * <p>Uncapped deliberately, unlike the path queries. The caller folds these into a handful of
     * named channels and one "other" bucket, and a {@code LIMIT} here would drop the long tail
     * before that folding happened — so a hundred small referrers that together outweigh the top
     * source would vanish from a chart whose entire job is share of total.
     *
     * @return {@code [referrerHost, sessions]} — the host is {@code ""} for a direct arrival
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> referrerSessions(LocalDate from, LocalDate to) {
        return em.createNativeQuery("""
                select referrer_host, sum(sessions) as sessions
                  from page_view_daily_referrers
                 where day >= :from and day < :to
                 group by referrer_host
                 order by sessions desc, referrer_host
                """)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
    }

    /**
     * Accounts created per IST day in the window, oldest first.
     *
     * <p><strong>Why signups are read here and not borrowed from {@code AdminMetricsRepository},
     * which already counts users by day.</strong> A conversion rate is a ratio of two counts, and a
     * ratio is only meaningful if both halves were cut on the same calendar. That repository buckets
     * over a caller-chosen interval with its own window semantics; using it would make the numerator
     * and denominator of "visitor → signup" agree only as long as two unrelated classes kept
     * agreeing about where a day starts. Ten lines of SQL that cut on the same boundary as the
     * rollup, in the same class as the traffic it is divided by, is the cheaper guarantee.
     *
     * <p>Days with no signups are absent, as in {@link #dailyTraffic}, and for the same reason.
     *
     * <p>The window is applied to the <em>converted</em> day rather than to {@code created_at}
     * directly. Comparing a {@code timestamptz} against a bare date makes Postgres read that date in
     * the session's zone, so on a UTC server the window would open at 05:30 IST — every day in the
     * chart would be sheared by five and a half hours against the page-view days beside it, and the
     * conversion rate would divide one calendar by another. This form cannot use an index on
     * {@code created_at}, which is the right trade: the row count here is accounts created, not
     * pages viewed, and being fast is worth less than being comparable.
     *
     * @return {@code [day, signups]}
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> dailySignups(LocalDate from, LocalDate to) {
        return em.createNativeQuery("""
                select cast(created_at at time zone 'Asia/Kolkata' as date) as day,
                       count(*) as signups
                  from users
                 where cast(created_at at time zone 'Asia/Kolkata' as date) >= :from
                   and cast(created_at at time zone 'Asia/Kolkata' as date) <  :to
                 group by day
                 order by day
                """)
                .setParameter("from", from)
                .setParameter("to", to)
                .getResultList();
    }
}
