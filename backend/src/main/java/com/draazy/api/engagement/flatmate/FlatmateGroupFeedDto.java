package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateGroupFeed} — the anonymous card projection of a group; what it
 * omits is the guarantee. Fields and why: docs/flows/consumer/flatmates.md §5.
 */
public record FlatmateGroupFeedDto(
        UUID id,
        String title,
        String locality,
        String policy,
        Long rent,
        Long perHead,
        int seatsTotal,
        int seatsOpen,
        List<FlatmateGroupDto.Member> members,
        UUID propertyId,
        String hostRole,
        String verificationTier,
        boolean agreementDeclared,
        boolean ownerConsent,
        String reviewStatus,
        List<String> tags,
        String note,
        String ownerName,
        Instant createdAt) {
}
