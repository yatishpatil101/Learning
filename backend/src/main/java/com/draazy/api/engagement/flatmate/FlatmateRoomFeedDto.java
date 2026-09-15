package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Card-sized projection of a room. Trust-forensics and unread fields are omitted so anonymous
 * reads can't leak them. See docs/flows/consumer/flatmates.md#supply-side-rationale-moved-from-backend-javadoc.
 */
public record FlatmateRoomFeedDto(
        UUID id,
        String type,
        UUID propertyId,
        String roomKind,
        String roomType,
        String attachedBath,
        String priceBasis,
        Long budget,
        Long deposit,
        String occupancy,
        int occupants,
        int maxOccupants,
        int flatCommitted,
        Integer flatMax,
        int shareMax,
        Integer seatsTotal,
        Integer seatsOpen,
        String hostRole,
        String verificationTier,
        boolean verified,
        String reviewStatus,
        String society,
        String flatNumber,
        String locality,
        List<String> localities,
        Double lat,
        Double lng,
        String bhk,
        String flatType,
        String homeTypeLabel,
        boolean gatedCommunity,
        String furnishing,
        String facing,
        String overlooking,
        String moveIn,
        String gender,
        String food,
        List<String> tags,
        String note,
        String owner,
        Instant createdAt) {
}
