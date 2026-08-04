package com.punenest.api.admin;

/**
 * Contract schema {@code AdminKpis} — the ops scorecard.
 *
 * @param revenue30d null for staff. The dashboard is staff-visible but {@code /admin/finance} is
 *     admin-only, so serving a revenue figure to staff here would contradict the very next
 *     operation in the contract (spec fix S61).
 */
public record AdminKpis(
        long totalListings,
        long activeListings,
        long pendingModeration,
        long totalUsers,
        long newUsers7d,
        long dealsClosed30d,
        Long revenue30d) {
}
