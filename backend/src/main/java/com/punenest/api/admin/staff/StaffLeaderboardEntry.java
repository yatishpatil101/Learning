package com.punenest.api.admin.staff;

/**
 * One row of the staff leaderboard.
 *
 * <p>Deliberately a count of actions and nothing else. The mock's version carried the same number
 * under the heading "performance", which is a claim this data cannot support — an audit row records
 * that something was done, not that it was done well or that it was worth doing. The page is
 * expected to present it as volume.
 *
 * @param actor the acting user's id; the value to pass back as the feed's {@code actor} filter
 * @param name  the acting user's name, or the raw actor handle if no account matches
 * @param role  {@code staff} or {@code admin}
 * @param team  the team the actor belongs to, or {@code null}
 * @param total how many actions they took in the window
 */
public record StaffLeaderboardEntry(
        String actor,
        String name,
        String role,
        String team,
        long total) {
}
