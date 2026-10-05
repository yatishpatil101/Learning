package com.draazy.api.moderation.verification;

import java.time.Instant;
import java.util.List;

// missingKinds is the reason the badge is not granted, making this worth returning.
public record OwnershipVerificationResponse(
        String propertyId,
        boolean verified,
        Instant verifiedAt,
        Instant verifiedUntil,
        List<String> missingKinds,
        List<Evidence> evidence,
        Instant requestedAt,
        Instant declinedAt,
        String declinedReason) {

    // Expired rows stay because the case file is a history, not a snapshot.
    public record Evidence(
            String id,
            String docType,
            String kind,
            String documentId,
            String subjectName,
            Instant issuedAt,
            Instant expiresAt,
            boolean current) {
    }
}
