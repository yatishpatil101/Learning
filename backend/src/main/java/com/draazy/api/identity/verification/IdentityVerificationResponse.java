package com.draazy.api.identity.verification;

import java.time.Instant;
import java.time.LocalDate;

/**
 * Wire shape of {@code GET /me/verification/identity} (contract {@code IdentityVerification}).
 * Deliberately thin — the user sees status only, never the OCR claim (that is for reviewers).
 */
public record IdentityVerificationResponse(
        String status,
        String docType,
        String docLast4,
        Instant submittedAt,
        Instant decidedAt,
        String rejectionReason,
        String rejectionNote,
        int attemptsRemaining,
        Instant retryAfter) {

    /** The parsed {@code claims} form field — what the on-device OCR read off the card. */
    public record Claims(String number, String name, LocalDate dob) {
    }
}
