package com.punenest.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * Full listing detail (contract {@code Property} = {@code PropertySummary} + detail + owner). The
 * entity↔wire boundary for the detail path; the JPA entity never crosses the wire.
 *
 * <p>Trust rule (ADR-019, badge-not-gate): the owner's mobile is <em>always emitted masked</em>
 * (e.g. {@code 98XXXXX210}) on this shape. Unmasking is a separate contact-gate slice — there is no
 * {@code 403} here, only a masked number, so the UI can render the "request contact" affordance
 * without ever seeing the raw digits until the gate is passed. The masking is applied server-side by
 * {@code PropertyMapper.toOwner} (hand-written, never generated), never in the client.
 *
 * <p>{@code adminPipeline} (staff post-on-behalf onboarding) is intentionally omitted — it belongs
 * to the moderation slice and is not needed by the consumer/owner surfaces this slice serves.
 */
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
        String city,
        Double lat,
        Double lng,
        String coverImage,
        boolean verified,
        String postedByType,
        String status,
        Instant createdAt,
        // ---- detail ----
        String description,
        Long deposit,
        Long maintenance,
        Boolean negotiable,
        String reraId,
        BigDecimal carpetArea,
        BigDecimal builtUpArea,
        BigDecimal superBuiltUpArea,
        Integer floor,
        Integer totalFloors,
        String facing,
        String possession,
        List<String> amenities,
        List<String> images,
        String floorPlan,
        String video,
        String address,
        String pincode,
        int views,
        int enquiries,
        boolean featured,
        String flagReason,
        boolean ownerVerified,
        boolean ownershipVerified,
        boolean societyVerified,
        boolean conveyanceDone,
        int docsCount,
        Owner owner) {

    /**
     * Owner summary embedded in the detail (contract {@code Property.owner}). {@code mobile} is the
     * masked form; the raw number is never placed here on this slice.
     *
     * @param id       owner user id
     * @param name     display name, nullable
     * @param mobile   masked mobile (e.g. {@code 98XXXXX210})
     * @param verified owner's identity "Verified" badge
     */
    public record Owner(String id, String name, String mobile, boolean verified) {
    }
}
