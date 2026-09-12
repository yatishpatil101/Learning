package com.draazy.api.admin;

import java.time.LocalDate;
import java.util.List;

/**
 * Contract {@code AdminAnalyticsSurfers} — the signed-out majority.
 *
 * <p>Anonymous by construction rather than by omission: every figure comes from aggregates that have
 * no identity column, so there is no query that could return a person here even if one were written
 * carelessly.
 *
 * <p><strong>The old tab's headline numbers were not independent measurements.</strong> Its
 * anonymous share was defined as {@code 100 − 12 × conversionRate} — one number displayed twice, in
 * two tiles, as though they corroborated each other. Its weekly chart used a different multiplier
 * again, so the bars and the tiles above them already disagreed. Both halves here are counted.
 *
 * @param days             the window the caller asked for
 * @param from             first IST day included
 * @param to               first IST day excluded
 * @param totalSessions    every browsing session in the window
 * @param anonSessions     sessions where nobody was signed in
 * @param signedInSessions sessions with at least one view made while signed in
 * @param signups          accounts created in the window
 * @param anonSharePct     anonymous share of sessions, 0–100, one decimal place; null when there
 *                         were no sessions, because a share of nothing is undefined and a zero here
 *                         would read as "everyone signed in"
 * @param conversionRatePct signups per session, 0–100, one decimal place; null when there were no
 *                         sessions, for the same reason
 * @param weeks            the anonymous/signed-in split by week
 * @param pages            the pages anonymous visitors reached, most-viewed first
 * @param dropOff          where sessions ended, most exits first
 */
public record AdminAnalyticsSurfers(
        int days,
        LocalDate from,
        LocalDate to,
        long totalSessions,
        long anonSessions,
        long signedInSessions,
        long signups,
        Double anonSharePct,
        Double conversionRatePct,
        List<AdminAnalyticsTraffic.IdentityWeek> weeks,
        List<Page> pages,
        List<Exit> dropOff) {

    /**
     * One page, with how much of its traffic was signed out.
     *
     * <p><strong>This replaced a per-page "signup rate" that was hard-coded and, separately,
     * plotted a hundred times too large</strong> — the chart multiplied a value already expressed as
     * a percentage by 100 again, drawing 210 where it meant 2.1. The defect survived because the
     * same axis carried view counts in the tens of thousands, so the wrong bars sat flat against the
     * baseline either way.
     *
     * <p>It is not fixed by correcting the arithmetic, because the figure was never derivable:
     * attributing a signup to the page that caused it means recording a landing page against the new
     * account, which is exactly the traffic-to-identity join this design exists to avoid. Anonymous
     * views against total views answers the neighbouring question — which pages the signed-out
     * majority actually reach — from data that is already collected, and puts both series on one
     * axis where they belong.
     *
     * @param path      matched route pattern; the console maps it to a display name
     * @param views     total views in the window
     * @param anonViews the subset made by signed-out visitors
     */
    public record Page(String path, long views, long anonViews) {
    }

    /**
     * One page sessions ended on.
     *
     * <p>An exit is the last view of a session <em>on that IST day</em> — a session running past
     * midnight exits once on each side. That follows from the rollup cutting sessions at midnight so
     * every day is computable from its own rows, and it is visible here rather than hidden because a
     * drop-off funnel that quietly counted some sessions twice would be worth knowing about.
     *
     * <p>Ranked by exits and not filtered to the busiest pages, deliberately. Taking the top pages
     * by views and re-sorting them would exclude a page everybody leaves from precisely because few
     * people reach it — which is the page this report exists to surface.
     *
     * @param path     matched route pattern
     * @param exits    sessions whose day ended here
     * @param sharePct percentage of all exits in the window, 0–100, one decimal place
     */
    public record Exit(String path, long exits, double sharePct) {
    }
}
