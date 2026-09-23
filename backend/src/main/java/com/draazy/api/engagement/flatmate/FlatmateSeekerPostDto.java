package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Contract schema {@code FlatmateSeekerPost}. {@link #mobile()} is null on the public feed, which
 * the contract declares {@code security: []} — a number there would be published to the internet. */
public record FlatmateSeekerPostDto(
        UUID id,
        String name,
        String gender,
        Integer age,
        String occupation,
        Long budget,
        Long budgetMax,
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
