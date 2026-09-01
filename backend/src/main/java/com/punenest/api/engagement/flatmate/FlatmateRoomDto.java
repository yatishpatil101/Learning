package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Contract schema {@code FlatmateRoom}.
 *
 * <p>Three of these fields are <strong>derived, never stored</strong> — {@link #flatCommitted},
 * {@link #flatMax} and {@link #shareMax}. They answer "how many more people can move in?", which is
 * a question about the whole flat rather than this row: storing them would mean every sibling room
 * had its own copy of one shared truth, and the copies would disagree the first time two rooms were
 * edited concurrently. The contract marks them {@code readOnly} for the same reason.
 *
 * <p>{@link #ownerMobile} is null on the anonymous feed and populated only for the host's own view.
 * A room's host is reachable through {@code POST /flatmates/rooms/&#123;id&#125;/interest}, where
 * the enquirer volunteers their own number — contact never travels outwards from a public read.
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
