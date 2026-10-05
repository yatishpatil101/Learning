package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.ListingProgress;
import com.draazy.api.moderation.signal.ListingSignals;
import java.time.Instant;
import java.util.List;

// Case file wire shape: checklist, oldest-first thread, and decision metadata.
public record PropertyReviewResponse(
        String propertyId,
        String status,
        String reviewer,
        List<ChecklistEntry> checklist,
        List<MessageEntry> messages,
        String notes,
        String reasonCode,
        String reasonNote,
        OverrideRequest overrideRequest,
        ListingSignals signals,
        Instant decidedAt,
        ListingProgress progress) {

    public record ChecklistEntry(String item, boolean pass) {
    }

    // from is server-derived; internal is always false in the owner's copy.
    public record MessageEntry(String id, String from, String body, Instant at, boolean read,
            boolean internal, boolean clarificationRequested) {
    }

    public record OverrideRequest(String id, String requestedBy, String reason, Instant at) {
    }
}
