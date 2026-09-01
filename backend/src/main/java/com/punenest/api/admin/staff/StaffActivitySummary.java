package com.punenest.api.admin.staff;

import java.util.List;

/**
 * The aggregate view of a window of back-office activity: how much, of what kind, and by whom.
 *
 * <p>Every number here is counted by the database over the whole window. The page this feeds used to
 * compute the same figures in the browser from the rows it had already loaded, which made the
 * leaderboard a ranking of the current page rather than of the team, and made "active staff" mean
 * "staff who appear in the rows we happened to fetch".
 *
 * @param total       every matching row in the window
 * @param staffCount  distinct actors in the window — the honest reading of "active staff"
 * @param byEntity    the split by kind of record acted on, busiest first; the page's KPI tiles
 * @param actions     the action vocabulary actually present in the window, alphabetical. Sent so the
 *                    filter offers verbs that exist rather than a list hardcoded in the frontend,
 *                    which is how the mock came to offer {@code packers} and {@code interior} —
 *                    service categories that were never audit actions.
 * @param leaderboard the busiest actors, capped; see {@link StaffActivityService}
 */
public record StaffActivitySummary(
        long total,
        long staffCount,
        List<StaffActivityCount> byEntity,
        List<String> actions,
        List<StaffLeaderboardEntry> leaderboard) {
}
