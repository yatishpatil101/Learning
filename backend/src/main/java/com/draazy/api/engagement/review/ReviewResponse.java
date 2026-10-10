package com.draazy.api.engagement.review;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;

/** The author is a display name only, never a mobile, so this DTO never touches the contact gate. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ReviewResponse(
        String id,
        String targetType,
        String targetId,
        String author,
        int rating,
        String title,
        String body,
        String context,
        Map<String, Integer> categories,
        Boolean recommend,
        Instant createdAt) {
}
