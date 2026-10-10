package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Author's and staff's view only; everyone else gets {@link FlatmateSeekerFeedDto}. */
public record FlatmateSeekerPostDto(
        UUID id,
        String title,
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
