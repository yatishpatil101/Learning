package com.draazy.api.services.request;

import java.time.Instant;

/**
 * Contract schema {@code ServiceRequestParty} — one side of a co-filled service request (D121).
 *
 * <p>Served in two places with two different jobs. Inside {@code ServiceRequest.parties} it tells
 * the people already on the matter who else is on it and whether they have answered. On
 * {@code GET /me/service-request-invites} it is the whole of what an invited person is shown before
 * they accept, which is why it carries {@link #requestType} and {@link #invitedBy} and carries
 * nothing about the agreement itself: enough to decide, and not the paperwork.
 *
 * @param party      the invited person's display name; {@code null} while the invitation is still
 *                   {@link #pending} — there is no account to take a name from — and also
 *                   {@code null} if a once-claimed account has since been removed
 * @param mobile     the invited number, <strong>masked</strong> ({@code 98XXXXX210}) and present
 *                   only while {@link #pending}. It is what the requester has instead of a name,
 *                   and enough of it is shown to answer the only question they ask of it: "is that
 *                   the number I meant?". Masked rather than whole because the reader of a
 *                   {@code ServiceRequest} is whoever is on the matter, and the other side's full
 *                   number is not theirs until that side has accepted — {@code ContactVisibility}
 *                   governs that everywhere else and this is not an exception to it.
 * @param pending    true while the invitation is addressed to a number rather than to an account
 *                   (V107). Distinct from {@code status = invited}, which means "has not answered":
 *                   a pending invitation has nobody who <em>could</em> answer yet, and the two
 *                   states want different words in the UI — "waiting for them to sign up" against
 *                   "waiting for them to reply".
 * @param invitedBy  who sent the invitation, as a display name — the fact that lets a recipient tell
 *                   an expected invite from one that arrived out of nowhere
 * @param status     {@code invited|accepted|declined}
 */
public record ServiceRequestPartyDto(
        String id,
        String requestId,
        String requestType,
        String role,
        String status,
        String party,
        String mobile,
        boolean pending,
        String invitedBy,
        Instant createdAt) {
}
