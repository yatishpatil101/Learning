package com.punenest.api.catalog.society;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * The contract's {@code Society} — a society as it appears in the directory.
 *
 * @param id                 identifier
 * @param slug               public URL key
 * @param name               display name
 * @param builder            developer, where known
 * @param localitySlug       the locality it sits in; null for unplaced bulk imports
 * @param lat                latitude
 * @param lng                longitude
 * @param year               year built or possession year
 * @param towers             number of towers
 * @param units              number of flats
 * @param occupancy          occupancy percentage, 0-100
 * @param maintenancePerSqft monthly maintenance in INR per sq ft
 * @param parkingRatio       parking spaces per unit
 * @param lifts              lifts per tower
 * @param security           security arrangement as free text (spec fix S25)
 * @param water              water supply arrangement
 * @param power              backup power arrangement
 * @param petPolicy          whether and how pets are allowed
 * @param vegPolicy          whether the society restricts non-vegetarian residents — a real and
 *                           legally contested filter in Indian housing, surfaced because hiding it
 *                           does not stop it being applied at the door
 * @param rera               MahaRERA registration id, null if none
 * @param registration       whether the society is registered
 * @param conveyance         whether the conveyance deed is done
 * @param amenities          amenity labels
 * @param source             {@code curated} / {@code rera} / {@code community} — provenance travels
 *                           with the record so a reader can weigh it
 * @param claimStatus        {@link SocietyClaimStatus}
 * @param listingCount       live listings in this society, computed on read (decision D7.2)
 * @param followerCount      followers, computed from {@code society_follows} — never the stored
 *                           {@code follower_count} column
 * @param followedByMe       whether the calling user follows it; false for anonymous callers
 */
public record SocietyResponse(
        UUID id,
        String slug,
        String name,
        String builder,
        String localitySlug,
        Double lat,
        Double lng,
        Integer year,
        Integer towers,
        Integer units,
        BigDecimal occupancy,
        BigDecimal maintenancePerSqft,
        BigDecimal parkingRatio,
        Integer lifts,
        String security,
        String water,
        String power,
        String petPolicy,
        String vegPolicy,
        String rera,
        boolean registration,
        boolean conveyance,
        List<String> amenities,
        String source,
        String claimStatus,
        long listingCount,
        long followerCount,
        boolean followedByMe) {
}
