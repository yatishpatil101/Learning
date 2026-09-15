package com.draazy.api.engagement.flatmate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateRoom}; {@code ownerMobile} is host-only, capacity fields derived.
 * Rationale: docs/flows/consumer/flatmates.md#supply-side-rationale-moved-from-backend-javadoc.
 */
public record FlatmateRoomDto(
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
        boolean agreementDeclared,
        String addressFingerprint,
        boolean flagForReview,
        String modStatus,
        String society,
        UUID societyId,
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
        LocalDate availableFrom,
        String gender,
        String food,
        List<String> tags,
        String note,
        List<String> photos,
        String owner,
        String ownerMobile,
        String status,
        Instant createdAt) {
}
