package com.punenest.api.catalog.society;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * The contract's {@code Society} — a society as it appears in the directory.
 *
 * @param slug               public URL key
 * @param builder            developer, where known
 * @param localitySlug       the locality it sits in; null for unplaced bulk imports
 * @param year               year built or possession year
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
 * @param source             {@code curated} / {@code rera} / {@code community} — provenance travels
 *                           with the record so a reader can weigh it
 * @param mintOrigin         {@code demand} / {@code listing} — which human action minted it, and a
 *                           different axis from {@code source} rather than an extension of it (see
 *                           {@link SocietyMintOrigins}). Null means not recorded, which is the case
 *                           for every row nobody minted and for every community row created before
 *                           V108; a reader must not treat null as "not demand"
 * @param claimStatus        {@link SocietyClaimStatus}
 * @param verifiedAt         when ops confirmed a community-minted society is real; null while it is
 *                           still a candidate, and null forever for curated and RERA rows, which
 *                           are verified by construction. Read together with {@code source}: a
 *                           {@code community} row with no {@code verifiedAt} is the one a reader
 *                           should weigh as "somebody typed this in"
 * @param listingCount       live listings in this society, computed on read (decision D7.2)
 * @param followerCount      followers, computed from {@code society_follows} — never the stored
 *                           {@code follower_count} column
 * @param followedByMe       whether the calling user follows it; false for anonymous callers
 * @param avgRating          average published rating, <strong>null when the society has no
 *                           reviews</strong> — no rating is not a rating of zero, and a card that
 *                           renders 0.0 for an unreviewed society is stating something false about
 *                           it. Computed on read via {@code common.trust.RatingLookup}, never the
 *                           stored {@code avg_rating} column
 * @param reviewCount        how many published reviews that average is over; without it the
 *                           average is unreadable (4.9 from one review is not 4.9 from two hundred)
 * @param createdAt          when the row appeared. Carried for the candidate queue, which is a
 *                           backlog: "minted an hour ago" and "minted three weeks ago and still
 *                           unverified" are the same row without it, and only the second is a
 *                           problem. Not sensitive — a building's existence is public the moment it
 *                           is listed — so it is on the shared response rather than an admin-only
 *                           projection that would make the queue row a different shape from every
 *                           other society the console reads
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
        String mintOrigin,
        java.time.Instant verifiedAt,
        String claimStatus,
        long listingCount,
        long followerCount,
        boolean followedByMe,
        BigDecimal avgRating,
        long reviewCount,
        java.time.Instant createdAt) {
}
