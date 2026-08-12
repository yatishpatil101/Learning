package com.punenest.api.services.request;

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
 * @param party      the invited person's display name, or {@code null} if their account has since
 *                   been removed
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
        String invitedBy,
        Instant createdAt) {
}
