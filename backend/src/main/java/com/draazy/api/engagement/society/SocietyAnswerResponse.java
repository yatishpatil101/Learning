package com.draazy.api.engagement.society;

import java.time.Instant;
import java.util.UUID;

/** One answer, with the same author treatment as {@link SocietyQuestionResponse}. */
public record SocietyAnswerResponse(
        UUID id,
        UUID questionId,
        String authorName,
        boolean authorIsResident,
        String body,
        Instant createdAt) {
}
