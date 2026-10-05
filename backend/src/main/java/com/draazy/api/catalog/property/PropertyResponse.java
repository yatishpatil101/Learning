package com.draazy.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Full listing detail; the entity↔wire boundary for the detail path. The owner's mobile is always
 * emitted masked by {@code PropertyMapper.toOwner}, never by the client. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertyResponse(
        String id,
        String slug,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        String priceUnit,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        String locality,
        String localitySlug,

        /** The society this home is in, keyed by slug because that is its public key; null when the
         * owner named none, and the client then renders no Society section rather than an empty one. */
        String societySlug,
        String city,
        Double lat,
        Double lng,
        String coverImage,
        boolean verified,
        String status,

        ListingProgress progress,

        // Deal outcome (active|reserved|closed). Carries the one state `status` cannot: `reserved`,
        // an under-offer listing whose moderation status is still `approved`.
        String dealStatus,
        Instant createdAt,

        // When the owner last confirmed the listing is still available. Public, because the
        // freshness badge is a buyer-facing signal; null makes the client fall back to `createdAt`.
        Instant lastConfirmedAt,
        Instant resubmittedAt,

        Instant ownershipRequestedAt,
        String ownershipDeclinedReason,

        // Server-side freshness tier and generated completeness score: both order or gate
        // search, which a browser cannot page. `qualityScore` is absent on a row not yet read back.
        Integer qualityScore,
        String freshness,

        String landUse,
        Integer ageYears,
        String room,
        List<String> tenants,
        String availableFrom,
        String availableDate,
        Boolean pets,

        String description,
        Long deposit,
        Long maintenance,
        Boolean negotiable,
        String ownership,
        Boolean loanAvailable,
        String agreementDuration,

        /** Lock-in and notice, in months. Promoted out of {@code formDetails} because that map is
         * owner/staff only, so a public viewer saw a client-side default in their place. */
        String lockIn,
        String noticePeriod,
        String foodPref,

        String bestTimeToCall,
        List<String> furniture,
        String reraId,
        BigDecimal carpetArea,
        BigDecimal builtUpArea,
        BigDecimal superBuiltUpArea,
        Integer floor,
        Integer totalFloors,
        String facing,
        String overlooking,

        // Owner-declared counts. Absent means unstated, so the page shows nothing rather than
        // deriving a confident wrong number from `bhk`.
        Integer bathrooms,
        Integer parking,
        Integer balconies,
        String possession,
        List<String> amenities,
        List<String> images,
        String floorPlan,
        String video,

        /** Street address including the unit — owner and staff only, and dangerous to publish.
         * Rationale: docs/system/cross-cutting.md#private-listing-fields-on-the-detail-response. */
        String address,
        String pincode,
        String societyId,

        /** Supplemental edit answers including unit-level address; owner/staff only. */
        Map<String, Object> formDetails,

        /** The unit's electricity meter number — owner and staff only; it names a live utility
         * account. Rationale: docs/system/cross-cutting.md#private-listing-fields-on-the-detail-response. */
        String electricityMeterNo,
        int views,
        int enquiries,
        boolean featured,

        /** Why a moderator took this listing down — back office only, withheld from the owner too.
         * Rationale: docs/system/cross-cutting.md#private-listing-fields-on-the-detail-response. */
        String flagReason,

        /** Is a stays-live moderation re-check queued? (Q14) Without it the stays-live and
         * revert-to-pending outcomes are indistinguishable on the wire. */
        boolean recheckPending,

        String recheckReason,

        Instant recheckRequestedAt,

        /** The soft-delete flag — a separate axis from {@code status}, not a sixth status value, so
         * a status-complete list can tell a live pending listing from an archived one. */
        boolean archived,
        boolean ownerVerified,
        boolean ownershipVerified,
        boolean societyVerified,
        boolean conveyanceDone,
        int docsCount,
        Owner owner,

        /** Everything a commercial listing answers that a home does not. Null rather than an all-empty
         * record so {@code NON_NULL} removes the key and a home's response never carries the concept. */
        Commercial commercial,

        /** Everything a plot or farm answers that a building does not. Null rather than an all-empty
         * record so {@code NON_NULL} removes the key and a flat's response never carries the concept. */
        Land land,

        /** The post-on-behalf onboarding funnel, or null for every audience but the back office —
         * null rather than {@code {}} so {@code NON_NULL} removes the key and conceals the concept. */
        AdminPipeline adminPipeline) {

    public record AdminPipeline(
            boolean postedByAdmin,
            String postedByStaff,
            int reminderCount) {
    }

    /** Owner summary embedded in the detail. {@code mobile} is the masked form; the raw number is
     * never placed here on this slice. */
    public record Owner(String id, String name, String mobile, boolean verified) {
    }

    /** The commercial answer set, lifted verbatim out of {@code formDetails}. Values stay Strings because
     * that is how {@code ListingFormDetails} validates them; parsing here would invent a second vocabulary. */
    public record Commercial(
            String commercialType,
            String shellType,
            String washrooms,
            String camCharges,
            Boolean powerBackup,
            Boolean pantry,
            List<String> suitableFor,
            List<String> fixtures,
            String gstOnRent,
            String fitOutMonths,
            String escalationPct,
            String tenancyStatus,
            String inPlaceRent,
            String leaseExpiry,
            String seatCount,
            String frontage,
            String floorLoad,
            String clearHeight,
            String sanctionedPower,
            String dockCount) {
    }

    public record Land(
            String plotZone,
            String waterSource,
            String naStatus,
            String otherRights,
            String buyerEligibility,
            String openSides,
            String roadWidth,
            String plotLength,
            String plotWidth,
            Boolean cornerPlot,
            Boolean boundaryWall,
            Boolean naSanctioned,
            Boolean electricity,
            Boolean roadAccess,
            Boolean satbara) {
    }
}
