package com.punenest.api.admin;

import java.time.LocalDate;
import java.util.List;

/**
 * Contract {@code AdminAnalyticsTraffic} — how much traffic arrived, over time and from where.
 *
 * <p>Every figure is measured. The tab this replaces generated its entire contents from a seeded
 * pseudo-random function, so "visits" was a number that moved when the page reloaded and not when
 * visitors arrived.
 *
 * <p><strong>Sessions, not "visits".</strong> A visit on this platform is a person going to look at
 * a property in the physical world, and the two words sat one underscore apart in the schema. A
 * session here is one browsing session in one browser tab.
 *
 * @param days     the window the caller asked for, echoed so a chart's axis cannot disagree with its
 *                 data
 * @param from     first IST day included
 * @param to       first IST day <em>excluded</em> — the window is half-open, so today is the last
 *                 day in it and is still accumulating
 * @param series   one entry per day in {@code [from, to)}, gaps filled with zeroes; see
 *                 {@link Day}
 * @param sources  where sessions came from, largest first, summing to the window's total
 * @param devices  the device split for the window
 * @param identity signed-in against signed-out sessions, by week
 */
public record AdminAnalyticsTraffic(
        int days,
        LocalDate from,
        LocalDate to,
        List<Day> series,
        List<Source> sources,
        Devices devices,
        List<IdentityWeek> identity) {

    /**
     * One IST day.
     *
     * <p><strong>Zero-filled, deliberately.</strong> The rollup writes no row for a day nobody
     * visited, so a day of genuinely no traffic and a day the job never ran look identical in the
     * table. The service fills the window's gaps with zeroes because the alternative is worse in a
     * specific way: a line chart handed a sparse series draws a straight segment across the missing
     * days, inventing a smooth trend precisely where there is no data. Zeroes are honest about a
     * quiet day and obvious about a broken job; a gap is silent about both.
     *
     * @param date      the IST day
     * @param sessions  browsing sessions that had at least one view that day
     * @param pageviews views, always at least {@code sessions}
     * @param signups   accounts created that day — the denominator's partner in the conversion rate,
     *                  cut on the same calendar so the ratio means something
     */
    public record Day(LocalDate date, long sessions, long pageviews, long signups) {
    }

    /**
     * One acquisition channel.
     *
     * <p>Channels rather than raw hosts: a doughnut with four hundred slices answers nothing, and
     * the long tail of individual referring sites is not a decision anybody makes. Folding happens
     * server-side so the vocabulary has one definition — see
     * {@code AdminPageViewAnalyticsService#channelOf}.
     *
     * <p><strong>There is no paid-ads channel and cannot be one.</strong> Identifying paid traffic
     * means reading {@code utm_source}, which lives in the query string, which the collector strips
     * before storing — because a query string also carries whatever the visitor typed into a search
     * box. That was the right trade for a table meant to hold no personal data, and this is its
     * cost, named rather than papered over with a slice that would always read zero.
     *
     * @param channel  display name, from a closed vocabulary
     * @param sessions sessions attributed to it
     * @param sharePct percentage of the window's sessions, 0–100, one decimal place
     */
    public record Source(String channel, long sessions, double sharePct) {
    }

    /**
     * The device split for the window, counted per session and not per view.
     *
     * <p>A session's device is the one it <em>arrived</em> on. Somebody who rotates a tablet or
     * drags a window between screens is one visitor on one device, and taking the most common view
     * instead would break ties arbitrarily while looking authoritative.
     */
    public record Devices(long mobile, long tablet, long desktop) {
    }

    /**
     * Signed-in against signed-out sessions for one week.
     *
     * <p><strong>This is what replaced "new vs returning", which was never measurable.</strong>
     * A session id is minted per browser tab and dies with it, so a returning visitor is
     * indistinguishable from a new one — not missing, structurally underivable, and the deliberate
     * price of a token that cannot accumulate into a profile. Signed-in against anonymous answers a
     * related question honestly rather than answering the original one falsely.
     *
     * @param week      the Monday the week starts on, {@code YYYY-MM-DD}
     * @param anonymous sessions with no account attached
     * @param signedIn  sessions where at least one view was made while signed in
     */
    public record IdentityWeek(LocalDate week, long anonymous, long signedIn) {
    }
}
