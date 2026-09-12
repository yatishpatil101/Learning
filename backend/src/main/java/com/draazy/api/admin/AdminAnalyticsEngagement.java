package com.draazy.api.admin;

import java.time.LocalDate;
import java.util.List;

/**
 * Contract {@code AdminAnalyticsEngagement} — what visitors did once they arrived.
 *
 * <p>The tab this replaces took no props and held no state: every number on it was a literal typed
 * into JSX, so "average session duration" was a figure that could not move no matter what visitors
 * did. Nothing here is preserved from it except the questions it claimed to answer.
 *
 * @param days     the window the caller asked for
 * @param from     first IST day included
 * @param to       first IST day excluded
 * @param weeks    session depth and bounce rate by week
 * @param topPages the busiest paths in the window, most-viewed first
 */
public record AdminAnalyticsEngagement(
        int days,
        LocalDate from,
        LocalDate to,
        List<Week> weeks,
        List<Page> topPages) {

    /**
     * One week's engagement.
     *
     * <p><strong>Both figures are nullable and neither may be zero-filled.</strong> A week with no
     * sessions has no average duration and no bounce rate — those are undefined, not zero — and
     * rendering a confident {@code 0.0 min} beside a confident {@code 0%} would tell an operator
     * that visitors arrived and left instantly, which is the opposite of what happened. The console
     * prints an em dash for null. This is the same rule the SLA report follows and the same rule its
     * seeded generator broke, defaulting compliance to a flawless {@code 100} whenever it had
     * nothing to measure.
     *
     * @param week              the Monday the week starts on
     * @param sessions          sessions that week, so a reader can see how thin an average is
     * @param avgSessionMinutes mean session length in decimal minutes, one decimal place; null when
     *                          there were no sessions
     * @param bounceRatePct     percentage of sessions that viewed exactly one page, 0–100, one
     *                          decimal place; null when there were no sessions
     */
    public record Week(LocalDate week, long sessions, Double avgSessionMinutes, Double bounceRatePct) {
    }

    /**
     * One page, counted over the whole window.
     *
     * <p><strong>Real view counts, not the 0–100 index the old chart plotted.</strong> That index
     * pinned the busiest page to exactly 100 and scaled the rest against it, which meant the chart
     * looked identical on a day with two hundred visitors and a day with twenty thousand — it could
     * show which page won and never whether anything was happening at all.
     *
     * <p><strong>The path is the matched route pattern, not a display name.</strong>
     * {@code /property/:id}, never {@code /property/kothrud-2bhk}. Turning that into "Property
     * detail" is the console's job because the console already owns the route-pattern list and has a
     * drift guard over it; a second copy of the same taxonomy on this side would be two definitions
     * of one thing, and the failure mode of two definitions is that somebody updates the one that is
     * easier to find.
     *
     * @param path      matched route pattern
     * @param views     total views in the window
     * @param anonViews the subset made by signed-out visitors
     */
    public record Page(String path, long views, long anonViews) {
    }
}
