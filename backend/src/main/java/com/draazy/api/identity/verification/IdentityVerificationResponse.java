package com.draazy.api.identity.verification;

import java.time.Instant;
import java.time.LocalDate;

// Deliberately thin: the user sees status only, never the reviewer OCR claim.
public record IdentityVerificationResponse(
        String status,
        String docType,
        String docLast4,
        Instant submittedAt,
        Instant decidedAt,
        String rejectionReason,
        String rejectionNote,
        Instant revokedAt,
        String revocationReason,
        int attemptsRemaining,
        Instant retryAfter) {

    public record Claims(String number, String name, LocalDate dob) {
    }
}
