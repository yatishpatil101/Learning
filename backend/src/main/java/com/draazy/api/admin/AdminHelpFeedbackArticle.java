package com.draazy.api.admin;

import java.time.Instant;

/** Verdicts on one article in one language; {@code comments} counts written reasons apart from the verdicts. */
public record AdminHelpFeedbackArticle(
        String slug,
        String lang,
        long helpful,
        long notHelpful,
        long comments,
        Instant lastAt) {
}
