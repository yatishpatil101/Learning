package com.draazy.api.admin;

import java.time.LocalDate;
import java.util.List;

/** Built only from aggregates with no identity column, so nothing here can return a person.
 * Rates are null with no sessions: a share of nothing is undefined, and zero would read as all signed in. */
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
        List<Page> pages,
        List<Exit> dropOff) {

    /** Anonymous views against total views per page; a per-page signup rate would need a landing page recorded
     * against the new account, which is the traffic-to-identity join this design avoids. */
    public record Page(String path, long views, long anonViews) {
    }

    /** An exit is a session's last view on that IST day, so a session past midnight exits once per side.
     * Not limited to the busiest pages, so a page few reach but everyone leaves still surfaces. */
    public record Exit(String path, long exits, double sharePct) {
    }
}
