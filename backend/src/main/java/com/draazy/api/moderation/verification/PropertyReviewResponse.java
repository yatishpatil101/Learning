package com.draazy.api.moderation.verification;

import java.time.Instant;
import java.util.List;

/**
 * Wire shape of the verification case file (contract {@code PropertyReview}): the checklist, the
 * owner&lt;-&gt;ops thread oldest first, and the decision with its note and timestamp.
 */
public record PropertyReviewResponse(
        String propertyId,
        String status,
        String reviewer,
        List<ChecklistEntry> checklist,
        List<MessageEntry> messages,
        String notes,
        Instant decidedAt,
        String lifecycleTrack,
        String lifecycleStage) {

    /** One checklist line. */
    public record ChecklistEntry(String item, boolean pass) {
    }

    /**
     * One thread message (contract {@code VerificationMessage}); {@code from} is derived server-side.
     * {@code internal} marks a staff-only finding, and is uniformly false in the owner's copy.
     */
    public record MessageEntry(String id, String from, String body, Instant at, boolean read,
            boolean internal, boolean clarificationRequested) {
    }
}
