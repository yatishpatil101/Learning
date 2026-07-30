package com.punenest.api.leads.contact;

/**
 * The caller's gate state for one listing (contract {@code ContactStatus}) — the single shape both
 * {@code contactStatus} and {@code requestContact} return, so the client renders the contact box from
 * one branch regardless of how it got there.
 *
 * @param status               one of {@link ContactStatuses}; {@code owner} and {@code none} are
 *                             computed server-side and never persisted
 * @param verifiedContactOnly  the <em>owner's</em> preference ({@code users.verified_contact_only}).
 *                             Reported even when it does not block this caller, because the UI shows
 *                             "this owner prefers verified buyers" as context, not only as an error
 * @param verificationRequired {@code verifiedContactOnly && !callerHasBadge} — true only when this
 *                             specific caller is blocked. The one condition under which
 *                             {@code requestContact} may 403 (ADR-019, badge-not-gate)
 */
public record ContactStatusResponse(
        String status,
        boolean verifiedContactOnly,
        boolean verificationRequired) {
}
