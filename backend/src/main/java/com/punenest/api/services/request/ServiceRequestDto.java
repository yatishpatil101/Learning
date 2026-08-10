package com.punenest.api.services.request;

import com.punenest.api.documents.vault.DocumentDto;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * Contract schema {@code ServiceRequest}.
 *
 * <p>{@code requesterId} is deliberately absent — it is not in the contract, and the only two
 * audiences are the requester (who knows) and ops (who read the name off the timeline). Putting a
 * user id on a wire object is how one leaks into a client-side filter later.
 *
 * @param details  the structured fields the customer filled at create time, echoed back (D119), or
 *                 {@code null} when the request carried none
 * @param assignee the staff member's display name, or {@code null} while unassigned
 * @param timeline server-written history, oldest first — the order a story is read in
 * @param messages the customer&lt;-&gt;ops conversation, oldest first
 * @param amount   what the customer was charged, in whole rupees, or {@code null} for a free desk
 * @param paymentSessionId the Cashfree session to hand the checkout SDK — present only on the create
 *                 response of a priced request, always {@code null} on read
 */
public record ServiceRequestDto(
        String id,
        String type,
        String status,
        String propertyId,
        Map<String, Object> details,
        String assignee,
        List<TimelineEntry> timeline,
        List<DocumentDto> documents,
        List<MessageDto> messages,
        Instant createdAt,
        Long amount,
        String paymentSessionId) {

    /** The inline timeline object of the {@code ServiceRequest} schema. */
    public record TimelineEntry(Instant at, String event, String by) {
    }

    /**
     * The same request carrying the checkout session for its gateway order. Used once, on the create
     * response of a priced request; the session is single-use and never stored, so it is stitched in
     * here rather than mapped from the entity.
     */
    public ServiceRequestDto withPaymentSessionId(String sessionId) {
        return new ServiceRequestDto(id, type, status, propertyId, details, assignee, timeline,
                documents, messages, createdAt, amount, sessionId);
    }
}
