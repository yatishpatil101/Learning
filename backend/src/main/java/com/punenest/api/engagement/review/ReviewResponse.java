package com.punenest.api.engagement.review;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.Map;

/**
 * The contract's {@code Review}.
 *
 * <p>{@code author} is the reviewer's display name, not their id: a review is a public document and
 * the reader needs a human to attribute it to. Nothing else about the author is exposed — in
 * particular no mobile, which is why this DTO never touches the contact gate.
 *
 * @param context   the server-derived "Verified resident" / "Visited" badge; null on society,
 *                  locality and owner reviews, which have no visit or tenancy to evidence
 * @param categories sparse per-aspect sub-ratings; empty rather than null so the client can iterate
 *                  without a guard
 * @param recommend null when the author did not answer — distinct from {@code false}
 */
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
