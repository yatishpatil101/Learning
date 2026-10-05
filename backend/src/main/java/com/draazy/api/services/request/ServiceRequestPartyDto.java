package com.draazy.api.services.request;

import java.time.Instant;

public record ServiceRequestPartyDto(
        String id,
        String requestId,
        String requestType,
        String role,
        int partyIndex,
        String status,
        String party,
        String mobile,
        boolean pending,
        String invitedBy,
        Instant createdAt) {
}
