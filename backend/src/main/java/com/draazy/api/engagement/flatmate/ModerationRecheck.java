package com.draazy.api.engagement.flatmate;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import lombok.Getter;

/** The stays-live re-check work item, embedded by a room, a group and a seeker post so the merge
 * rule (see {@code Property#requestRecheck}) has one spelling rather than three. */
@Embeddable
@Getter
class ModerationRecheck {

    /** Null means no pending re-check. Its age is the SLA, so it survives later edits. */
    @Column(name = "recheck_requested_at")
    private Instant requestedAt;

    /** Comma-joined field names, accumulated across edits — what the moderator actually reads. */
    @Column(name = "recheck_reason")
    private String reason;

    /** A post that is no longer public is already in the moderation queue, and a full re-moderation
     * supersedes a re-check outright. */
    void settle(String modStatus, List<String> fields) {
        if (FlatmateVocabulary.isPublic(modStatus)) {
            request(fields);
        } else {
            clear();
        }
    }

    /** The timestamp is kept at the first unreviewed edit, so a host who re-crops their photos
     * daily cannot reset their own place in the queue. */
    private void request(List<String> fields) {
        if (fields == null || fields.isEmpty()) {
            return;
        }
        LinkedHashSet<String> merged = new LinkedHashSet<>();
        if (reason != null && !reason.isBlank()) {
            Collections.addAll(merged, reason.split(",\\s*"));
        }
        merged.addAll(fields);
        this.reason = String.join(", ", merged);
        if (requestedAt == null) {
            this.requestedAt = Instant.now();
        }
    }

    /** A moderator has looked: drop the work item. Idempotent. */
    void clear() {
        this.requestedAt = null;
        this.reason = null;
    }
}
