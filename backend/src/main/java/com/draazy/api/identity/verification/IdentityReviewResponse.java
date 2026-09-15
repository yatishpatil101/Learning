package com.draazy.api.identity.verification;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Wire shape of a queue card (contract {@code IdentityReview}); {@code images} are short-lived
 * signed URLs, {@code warnings} carry dedup signals a reviewer must weigh before approving.
 */
public record IdentityReviewResponse(
        UUID id,
        UUID userId,
        String userName,
        String userMobile,
        String userRole,
        String status,
        String docType,
        Claims claims,
        String claimedHash,
        String docLast4,
        String holderName,
        LocalDate holderDob,
        int attemptCount,
        Instant submittedAt,
        Instant decidedAt,
        String reviewerName,
        String rejectionReason,
        String rejectionNote,
        Instant filesPurgedAt,
        Images images,
        List<Warning> warnings) {

    /** The OCR claim as stored: {@code number} is the last 4 only, the full number never lands. */
    public record Claims(String number, String name, LocalDate dob) {
    }

    public record Images(String front, String back, String selfie) {
    }

    /**
     * Dedup signal shown on a queue card; {@code kind} is {@code same_document_verified} (hard),
     * {@code same_document_claimed}, or {@code same_person_key} (name+DOB match; soft).
     */
    public record Warning(String kind, UUID userId, String userName, UUID reviewId) {
    }
}
