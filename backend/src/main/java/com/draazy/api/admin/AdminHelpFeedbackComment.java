package com.draazy.api.admin;

import java.time.Instant;
import java.util.UUID;

/** Verbatim reader text: render as text only, and neutralise a leading formula character in CSV export. */
public record AdminHelpFeedbackComment(
        UUID id,
        String slug,
        String lang,
        boolean helpful,
        String comment,
        Instant createdAt) {
}
