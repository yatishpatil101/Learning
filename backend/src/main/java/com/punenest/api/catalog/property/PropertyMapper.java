package com.punenest.api.catalog.property;

import com.punenest.api.catalog.listing.ListingCreate;
import com.punenest.api.common.trust.BackOfficeVisibility;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.trust.OutreachCounts;
import com.punenest.api.common.trust.PrivateFieldVisibility;
import com.punenest.api.identity.user.User;
import java.util.UUID;
import org.mapstruct.BeanMapping;
import org.mapstruct.Context;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;
import org.mapstruct.NullValuePropertyMappingStrategy;
import org.mapstruct.ReportingPolicy;

/**
 * Entity→wire mapper for the catalogue (MapStruct-generated implementation, wired as a Spring bean).
 * Replaces the hand-written {@code PropertyResponse.from}/{@code PropertySummary.from} factories: the
 * {@code Property} detail shape is ~43 near-1:1 fields, exactly where a manual constructor call is
 * both tedious and a silent transcription-error hazard. Generating it gives compile-time
 * unmapped-target checking as the DTOs evolve.
 *
 * <p><strong>Security carve-out (ADR-019, badge-not-gate):</strong> owner-contact masking is
 * <em>not</em> generated — {@link #toOwner(User, ContactVisibility)} is hand-written and explicit so
 * the single most important trust rule on this surface (never emit a raw owner mobile before the
 * contact gate) stays visible in code review rather than buried in a generated
 * {@code @Mapping(expression=...)}. The mechanical fields are generated; the trust decision is
 * authored. {@code PropertySummary} carries no owner contact at all, so its card mapping is fully
 * mechanical.
 */
// Why ERROR: an unmapped response field is a silent contract hole - the UI would receive null with
// no build signal. Failing the compile forces every new DTO field to be mapped or explicitly ignored.
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface PropertyMapper {

    /** Card projection for search/lists — fully mechanical, no owner contact by construction. */
    PropertySummary toSummary(Property property);

    /**
     * Full detail projection. The {@code owner} field is shaped by {@link #toOwner(User,
     * ContactVisibility)} according to the caller's contact-gate decision.
     *
     * <p>The visibility is a required argument rather than an overload defaulting to masked, on
     * purpose: every call site must state which trust posture it is rendering under, so adding a new
     * detail endpoint cannot accidentally inherit "reveal".
     */
    @Mapping(target = "adminPipeline", expression = "java(toAdminPipeline(property, backOffice, outreach))")
    @Mapping(target = "electricityMeterNo",
            expression = "java(privateFields == com.punenest.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getElectricityMeterNo() : null)")
    @Mapping(target = "address",
            expression = "java(privateFields == com.punenest.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getAddress() : null)")
    PropertyResponse toResponse(Property property, @Context ContactVisibility visibility,
            @Context BackOfficeVisibility backOffice, @Context OutreachCounts outreach,
            @Context PrivateFieldVisibility privateFields);

    /**
     * Copy the client-settable half of a create body onto a listing the service already constructed.
     *
     * <p><strong>{@code ignoreByDefault = true} turns {@code ListingCreate}'s "deliberately absent"
     * list into something the compiler enforces.</strong> That Javadoc names {@code status},
     * {@code owner}, {@code priceUnit}, {@code postedByType}, {@code verified} and {@code featured}
     * as server-owned "prevents self-escalation / spoofing" — but nothing enforced it: a
     * {@code p.setStatus(in.status())} added to the service would have compiled, read like the
     * eighteen mechanical setters around it, and let a listing be born approved. As an allowlist,
     * a field must be named here to be client-settable, so granting one is a visible diff.
     *
     * <p><strong>{@code NullValuePropertyMappingStrategy.IGNORE}</strong> reproduces the three
     * {@code if (x != null)} guards the hand-written version carried: {@code areaUnit}
     * ({@code "sqft"}), {@code amenities} and {@code images} (empty lists) have entity-level
     * defaults that a null in the body must not overwrite. Every other field defaults to null, so
     * ignoring a null and assigning one are the same outcome.
     *
     * <p>{@code localitySlug} is absent on purpose even though it is derived rather than trusted:
     * the resolver needs {@code lat}/{@code lng}, so the service sets it after this call.
     */
    @BeanMapping(ignoreByDefault = true,
            nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "bhk", source = "bhk")
    @Mapping(target = "deposit", source = "deposit")
    @Mapping(target = "maintenance", source = "maintenance")
    @Mapping(target = "negotiable", source = "negotiable")
    @Mapping(target = "area", source = "area")
    @Mapping(target = "areaUnit", source = "areaUnit")
    @Mapping(target = "furnishing", source = "furnishing")
    @Mapping(target = "lat", source = "lat")
    @Mapping(target = "lng", source = "lng")
    @Mapping(target = "reraId", source = "reraId")
    @Mapping(target = "possession", source = "possession")
    @Mapping(target = "amenities", source = "amenities")
    @Mapping(target = "images", source = "images")
    @Mapping(target = "description", source = "description")
    @Mapping(target = "address", source = "address")
    @Mapping(target = "floor", source = "floor")
    @Mapping(target = "societyId", source = "societyId")
    @Mapping(target = "electricityMeterNo", source = "electricityMeterNo")
    void applyTo(ListingCreate in, @MappingTarget Property property);

    /**
     * Hand-written owner projection embedded in the detail — the trust boundary. Masked
     * ({@code 98XXXXX210}) unless the caller's gate status for this listing is {@code owner} or
     * {@code approved}, which is exactly what {@link ContactVisibility#REVEALED} encodes. Kept
     * explicit (not generated) so the masking cannot be silently lost in a DTO refactor, and so the
     * reveal condition is a single readable line rather than a generated expression.
     */
    default PropertyResponse.Owner toOwner(User owner, @Context ContactVisibility visibility) {
        if (owner == null) {
            return null;
        }
        String mobile = visibility == ContactVisibility.REVEALED
                ? owner.getMobile()
                : maskMobile(owner.getMobile());
        return new PropertyResponse.Owner(
                owner.getId().toString(), owner.getName(), mobile, owner.isVerified());
    }

    /** Opaque-id convention: the wire exposes the UUID as a string. Shared by every id field here. */
    default String map(UUID value) {
        return value == null ? null : value.toString();
    }

    /**
     * Hand-written back-office projection — the second trust boundary on this DTO.
     *
     * <p>Returns null for every audience but staff, which {@code @JsonInclude(NON_NULL)} turns into
     * an absent key. Explicit rather than generated for the same reason as {@link #toOwner}: the
     * condition that decides whether the platform admits it manufactured a listing should be one
     * readable line, not something a DTO refactor can quietly drop.
     *
     * <p>Null is also returned for listings staff never posted, even to staff. There is no funnel to
     * report on an owner's own listing, and an object of all-false booleans would put it on the
     * board as work that will never complete.
     */
    default PropertyResponse.AdminPipeline toAdminPipeline(Property property,
            @Context BackOfficeVisibility backOffice, @Context OutreachCounts outreach) {
        if (backOffice != BackOfficeVisibility.VISIBLE || property == null
                || !property.isPostedByAdmin()) {
            return null;
        }
        String stage = property.getPipelineStage();
        return new PropertyResponse.AdminPipeline(
                true,
                property.getPostedByStaff(),
                stage,
                PipelineStage.reached(stage, PipelineStage.CLAIM_SENT),
                PipelineStage.reached(stage, PipelineStage.PHOTOS_UPLOADED),
                PipelineStage.reached(stage, PipelineStage.AADHAAR_VERIFIED),
                outreach.forSubject(property.getId()));
    }

    /**
     * Mask a 10-digit mobile to the contract form {@code 98XXXXX210}. Delegates to
     * {@link MobileMask} — the single definition shared with every other trust surface, extracted in
     * slice 4 when this rule was about to acquire a sixth copy. Anything that is not a clean 10-digit
     * number becomes {@code null} rather than a partial leak.
     *
     * <p>{@code private} so MapStruct never mistakes it for an implicit {@code String→String} mapping
     * and applies it to other fields.
     */
    private String maskMobile(String mobile) {
        return MobileMask.mask(mobile);
    }
}
