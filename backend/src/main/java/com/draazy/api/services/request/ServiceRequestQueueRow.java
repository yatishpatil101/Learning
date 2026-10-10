package com.draazy.api.services.request;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ServiceRequestQueueRow(
        String id,
        String type,
        ServiceRequestStatus status,
        Map<String, Object> details,
        String assignee,
        boolean assignedToMe,
        Instant createdAt,
        Long amount,
        ServiceRequestDto.Sla sla,
        String draftCheckStatus,
        boolean policeConfirmed,
        Instant approvedAt) {
}
