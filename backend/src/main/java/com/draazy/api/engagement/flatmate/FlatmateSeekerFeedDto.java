package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** A seeker post as anyone but its author sees it: no moderation verdict, no contact, coarse coordinates. */
public record FlatmateSeekerFeedDto(
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
        Double lat,
        Double lng,
        Instant createdAt) {
}
