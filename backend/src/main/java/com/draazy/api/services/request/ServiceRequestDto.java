package com.draazy.api.services.request;

import com.draazy.api.documents.vault.DocumentSummary;
import java.time.Instant;
import java.util.List;
import java.util.Map;

// requesterId stays off wire: requesters know it, ops read names from timeline.
// Exposing ids invites later client-side filtering leaks.
public record ServiceRequestDto(
        String id,
        String type,
        String team,
        ServiceRequestStatus status,
        String propertyId,
        String ticketId,
        Map<String, Object> details,
        String assignee,
        boolean assignedToMe,
        List<TimelineEntry> timeline,
        List<DocumentSummary> documents,
        List<MessageDto> messages,
        List<ServiceRequestPartyDto> parties,
        Instant createdAt,
        Long amount,
        String paymentSessionId,
        RegistrationDto registration,
        PoliceIntimationDto policeIntimation,
        Sla sla,
        Amendment amendment,
        DraftApproval draftApproval,
        DraftCheck draftCheck) {

    public record TimelineEntry(Instant at, String event, String by) {
    }

    public record Sla(String waitingOn, Instant dueAt, boolean overdue) {
    }

    public record Amendment(String id, Map<String, Object> terms, String reason, long amountBefore,
            long amountAfter, long delta, boolean checkoutOpen, Instant proposedAt) {
    }

    public record DraftApproval(int version, int approved, int total,
            List<DraftApprovalParty> parties) {
    }

    public record DraftApprovalParty(String key, String label, String method, String mobile,
            boolean opened, boolean approved, Instant approvedAt) {
    }

    public record DraftCheck(int version, String status, List<String> reasons, String note,
            String sharedBy, String checkedBy, Instant checkedAt) {
    }

    // Stitches the single-use gateway session onto create response; it is never stored.
    public ServiceRequestDto withPaymentSessionId(String sessionId) {
        return new ServiceRequestDto(id, type, team, status, propertyId, ticketId, details, assignee,
                assignedToMe, timeline, documents, messages, parties, createdAt, amount, sessionId, registration,
                policeIntimation, sla, amendment, draftApproval, draftCheck);
    }
}
