package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateSeekerPost}.
 *
 * <p><strong>{@link #mobile()} is null on the public feed and populated only for the post's own
 * author.</strong> This payload is served by {@code GET /flatmates/posts}, which the contract
 * declares {@code security: []} — there is no caller to gate against, so a number here would be
 * published to the internet rather than merely shown to somebody who asked. The precedent is
 * {@code PropertySummary}, the platform's other anonymous list, which carries no owner contact
 * either.
 *
 * <p>Contact still moves, but only in the direction the person it belongs to chose: see
 * {@code POST /flatmates/posts/&#123;id&#125;/interest}, where the <em>requester</em> hands over
 * their own number. The seeker's number is never released by a read.
 */
public record FlatmateSeekerPostDto(
        UUID id,
        String name,
        String gender,
        Integer age,
        String occupation,
        Long budget,
        List<String> localities,
        String moveIn,
        String flatPref,
        String roomPref,
        List<String> tags,
        String note,
        boolean verifiedContactOnly,
        boolean verified,
        String modStatus,
        String mobile,
        Double lat,
        Double lng,
        Instant createdAt) {
}
