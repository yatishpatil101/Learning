package com.punenest.api.moderation.verification;

import java.time.Instant;
import java.util.List;

/**
 * Wire shape of the verification case file (contract {@code PropertyReview}).
 *
 * @param propertyId the listing under review
 * @param reviewer   staff handle that took the case, else null
 * @param checklist  the verification checklist, one entry per required document
 * @param messages   the owner&lt;-&gt;ops clarification thread, oldest first (added by spec fix S34)
 * @param notes      the decision note
 * @param decidedAt  when the decision was taken, else null
 */
public record PropertyReviewResponse(
        String propertyId,
        String status,
        String reviewer,
        List<ChecklistEntry> checklist,
        List<MessageEntry> messages,
        String notes,
        Instant decidedAt) {

    /** One checklist line. */
    public record ChecklistEntry(String item, boolean pass) {
    }

    /**
     * One thread message (contract {@code VerificationMessage}).
     *
     * @param from {@code owner} or {@code ops}, derived server-side from the sender
     */
    public record MessageEntry(String id, String from, String body, Instant at, boolean read) {
    }
}
