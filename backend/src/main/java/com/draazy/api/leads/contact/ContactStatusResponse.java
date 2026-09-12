package com.draazy.api.leads.contact;

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
 * @param ownerHidesNumber     the owner's other preference ({@code users.hide_number}, D5): they
 *                             accept contact but do not hand out digits. Reported so an approved
 *                             buyer is told <em>why</em> the number is still masked instead of being
 *                             shown a masked string that looks like a bug — the UI says "this owner
 *                             prefers to chat" and points at the conversation. This flag is
 *                             explanatory only; the reveal itself is decided in
 *                             {@code ContactGateService} and a client that ignores this field cannot
 *                             thereby see a number
 */
public record ContactStatusResponse(
        String status,
        boolean verifiedContactOnly,
        boolean verificationRequired,
        boolean ownerHidesNumber) {
}
