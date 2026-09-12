package com.draazy.api.moderation.verification;

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
     * <p>{@code internal} is only ever {@code true} for a staff reader: the owner's copy of the
     * thread has internal messages filtered out entirely, so for them the field is uniformly
     * {@code false} and carries nothing. It exists because filtering alone left staff unable to tell
     * a staff-only finding from something the owner was actually told — both arrived as
     * {@code from: "ops"}, in one conversation, under a heading that says the owner can read it. A
     * moderator acting on that misreading is the same disclosure the filter was added to prevent,
     * one step later.
     *
     * @param from {@code owner} or {@code ops}, derived server-side from the sender
     * @param internal staff-only; the owner never receives a message where this would be true
     */
    public record MessageEntry(String id, String from, String body, Instant at, boolean read,
            boolean internal) {
    }
}
