package com.draazy.api.documents.request;

import java.time.Instant;
import java.util.List;

public record DocumentRequestDto(
        String id,
        String propertyId,
        Party requester,
        List<String> categories,
        String status,
        int sharedDocumentCount,
        Instant expiresAt,
        boolean acknowledgedDisclaimer,
        Instant createdAt) {

    /** Contract schema {@code Party}, projected for this surface. */
    public record Party(String id, String name, String mobile, String role) {
    }
}
