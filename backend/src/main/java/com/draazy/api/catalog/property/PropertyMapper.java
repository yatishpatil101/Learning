package com.draazy.api.catalog.property;

import com.draazy.api.catalog.listing.ListingCreate;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.FlagReasonVisibility;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.trust.PrivateFieldVisibility;
import com.draazy.api.identity.user.User;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;
import org.mapstruct.BeanMapping;
import org.mapstruct.Context;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.MappingTarget;
import org.mapstruct.NullValuePropertyMappingStrategy;
import org.mapstruct.ReportingPolicy;

/** Entity→wire mapper for the catalogue. Mechanical fields are generated; the trust decisions —
 * {@link #toOwner} masking and {@link #toAdminPipeline} — are hand-written so a refactor cannot lose them. */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface PropertyMapper {

    /** The freshness tier, derived at map time and shared by the card and detail mappings so there is
     * exactly one definition. {@link Freshness} takes the clock, so boundaries stay testable. */
    String FRESHNESS = "java(Freshness.of(property.getLastConfirmedAt(), property.getCreatedAt(),"
            + " java.time.Instant.now()).wire())";

    /** The cover, derived at map time so a listing's own photos are its card image. */
    String COVER = "java(coverImage(property))";

    List<String> LAND_KEYS = List.of("plotZone", "waterSource", "naStatus", "otherRights",
            "buyerEligibility", "openSides", "roadWidth", "plotLength", "plotWidth", "cornerPlot",
            "boundaryWall", "naSanctioned", "electricity", "roadAccess", "satbara");

    @Mapping(target = "imageCount",
            expression = "java(property.getImages() == null ? 0 : property.getImages().size())")
    @Mapping(target = "coverImage", expression = COVER)
    @Mapping(target = "freshness", expression = FRESHNESS)
    PropertySummary toSummary(Property property);

    @Mapping(target = "adminPipeline", expression = "java(toAdminPipeline(property, backOffice, outreach))")
    @Mapping(target = "progress", expression = "java(toProgress(property, backOffice, privateFields))")
    @Mapping(target = "coverImage", expression = COVER)
    @Mapping(target = "freshness", expression = FRESHNESS)
    @Mapping(target = "flagReason",
            expression = "java(flagReason == com.draazy.api.common.trust.FlagReasonVisibility.VISIBLE"
                    + " ? property.getFlagReason() : null)")
    @Mapping(target = "electricityMeterNo",
            expression = "java(privateFields == com.draazy.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getElectricityMeterNo() : null)")
    @Mapping(target = "address",
            expression = "java(privateFields == com.draazy.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getAddress() : null)")
    @Mapping(target = "formDetails",
            expression = "java(privateFields == com.draazy.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getFormDetails() : null)")
    @Mapping(target = "resubmittedAt",
            expression = "java(privateFields == com.draazy.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getResubmittedAt() : null)")
    @Mapping(target = "ownershipRequestedAt",
            expression = "java(privateFields == com.draazy.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getOwnershipRequestedAt() : null)")
    @Mapping(target = "ownershipDeclinedReason",
            expression = "java(privateFields == com.draazy.api.common.trust.PrivateFieldVisibility.VISIBLE"
                    + " ? property.getOwnershipDeclinedReason() : null)")
    @Mapping(target = "ownership", expression = "java(formDetailText(property, \"ownership\"))")
    @Mapping(target = "loanAvailable", expression = "java(formDetailBoolean(property, \"loanAvailable\"))")
    @Mapping(target = "agreementDuration", expression = "java(formDetailText(property, \"agreementDuration\"))")
    @Mapping(target = "lockIn", expression = "java(formDetailText(property, \"lockIn\"))")
    @Mapping(target = "noticePeriod", expression = "java(formDetailText(property, \"noticePeriod\"))")
    @Mapping(target = "foodPref", expression = "java(foodPref(property))")
    @Mapping(target = "bestTimeToCall", expression = "java(formDetailText(property, \"bestTimeToCall\"))")
    @Mapping(target = "availableDate", expression = "java(formDetailIsoDate(property, \"availableFrom\"))")
    @Mapping(target = "furniture", expression = "java(formDetailStrings(property, \"furniture\"))")
    @Mapping(target = "commercial", expression = "java(toCommercial(property))")
    @Mapping(target = "land", expression = "java(toLand(property))")
    PropertyResponse toResponse(Property property, @Context ContactVisibility visibility,
            @Context BackOfficeVisibility backOffice, @Context OutreachCounts outreach,
            @Context PrivateFieldVisibility privateFields,
            @Context FlagReasonVisibility flagReason);

    default PropertyResponse toResponse(Property property, ContactVisibility visibility,
            BackOfficeVisibility backOffice, OutreachCounts outreach,
            PrivateFieldVisibility privateFields) {
        return toResponse(property, visibility, backOffice, outreach, privateFields,
                backOffice == BackOfficeVisibility.VISIBLE
                        ? FlagReasonVisibility.VISIBLE : FlagReasonVisibility.HIDDEN);
    }

    /** Copy the client-settable half of a create body onto a listing the service already constructed.
     * {@code ignoreByDefault} makes this an allowlist, so granting a client-settable field is a diff. */
    @BeanMapping(ignoreByDefault = true,
            nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.IGNORE)
    @Mapping(target = "bhk", source = "bhk")
    @Mapping(target = "deposit", source = "deposit")
    @Mapping(target = "maintenance", source = "maintenance")
    @Mapping(target = "negotiable", source = "negotiable")
    @Mapping(target = "area", source = "area")
    @Mapping(target = "carpetArea", source = "carpetArea")
    @Mapping(target = "builtUpArea", source = "builtUpArea")
    @Mapping(target = "superBuiltUpArea", source = "superBuiltUpArea")
    @Mapping(target = "availableFrom", source = "availableFrom")
    @Mapping(target = "pets", source = "pets")
    @Mapping(target = "pincode", source = "pincode")
    @Mapping(target = "formDetails", source = "formDetails")
    @Mapping(target = "areaUnit", source = "areaUnit")
    @Mapping(target = "landUse", source = "landUse")
    @Mapping(target = "furnishing", source = "furnishing")
    @Mapping(target = "lat", source = "lat")
    @Mapping(target = "lng", source = "lng")
    @Mapping(target = "reraId", source = "reraId")
    @Mapping(target = "possession", source = "possession")
    @Mapping(target = "tenants", source = "tenants")
    @Mapping(target = "amenities", source = "amenities")
    @Mapping(target = "images", source = "images")

    // Blank is the wizard's "no photo tagged"; the column's word for that is NULL, not "".
    @Mapping(target = "floorPlan",
            expression = "java(in.floorPlan() == null || in.floorPlan().isBlank() ? null : in.floorPlan())")
    @Mapping(target = "video",
            expression = "java(in.video() == null || in.video().isBlank() ? null : in.video())")
    @Mapping(target = "description", source = "description")
    @Mapping(target = "address", source = "address")
    @Mapping(target = "floor", source = "floor")

    /** A field to ListingCreate WITHOUT a line here is dropped in silence: it compiles, no test
     * fails, the POST returns 201, and the value never reaches the row. Add both in the same edit. */
    @Mapping(target = "bathrooms", source = "bathrooms")
    @Mapping(target = "parking", source = "parking")
    @Mapping(target = "balconies", source = "balconies")
    @Mapping(target = "facing", source = "facing")
    @Mapping(target = "overlooking", source = "overlooking")
    @Mapping(target = "totalFloors", source = "totalFloors")
    @Mapping(target = "ageYears", source = "ageYears")
    @Mapping(target = "societyId", source = "societyId")
    @Mapping(target = "electricityMeterNo", source = "electricityMeterNo")
    void applyTo(ListingCreate in, @MappingTarget Property property);

    /** Hand-written owner projection — the trust boundary. Masked unless the caller's gate status is
     * {@link ContactVisibility#REVEALED}, kept explicit so a DTO refactor cannot drop the masking. */
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

    default String formDetailText(Property property, String key) {
        Object value = formDetail(property, key);
        return value instanceof String text ? text : null;
    }

    default String foodPref(Property property) {
        String food = formDetailText(property, "food");
        return food != null ? food : formDetailText(property, "foodPref");
    }

    default Boolean formDetailBoolean(Property property, String key) {
        Object value = formDetail(property, key);
        return value instanceof Boolean flag ? flag : null;
    }

    default String formDetailIsoDate(Property property, String key) {
        String value = formDetailText(property, key);
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value).toString();
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    default List<String> formDetailStrings(Property property, String key) {
        Object value = formDetail(property, key);
        if (!(value instanceof List<?> values) || !values.stream().allMatch(String.class::isInstance)) {
            return null;
        }
        return values.stream().map(String.class::cast).toList();
    }

    private Object formDetail(Property property, String key) {
        return property.getFormDetails() == null ? null : property.getFormDetails().get(key);
    }

    private static boolean answered(Object value) {
        return value instanceof Boolean flag ? flag : value instanceof String text && !text.isBlank();
    }

    /** The commercial answers, or null when the listing holds none. Presence decides rather than the
     * declared type, which is a free-text label a legacy row may carry any spelling of. */
    default PropertyResponse.Commercial toCommercial(Property property) {
        if (formDetail(property, "commercialType") == null) {
            return null;
        }
        return new PropertyResponse.Commercial(
                formDetailText(property, "commercialType"),
                formDetailText(property, "shellType"),
                formDetailText(property, "washrooms"),
                formDetailText(property, "camCharges"),
                formDetailBoolean(property, "powerBackup"),
                formDetailBoolean(property, "pantry"),
                formDetailStrings(property, "suitableFor"),
                formDetailStrings(property, "fixtures"),
                formDetailText(property, "gstOnRent"),
                formDetailText(property, "fitOutMonths"),
                formDetailText(property, "escalationPct"),
                formDetailText(property, "tenancyStatus"),
                formDetailText(property, "inPlaceRent"),
                formDetailText(property, "leaseExpiry"),
                formDetailText(property, "seatCount"),
                formDetailText(property, "frontage"),
                formDetailText(property, "floorLoad"),
                formDetailText(property, "clearHeight"),
                formDetailText(property, "sanctionedPower"),
                formDetailText(property, "dockCount"));
    }

    /** The land answers, or null when none was answered. Unlike the commercial keys these are not
     * stripped from a residential post, so keying off presence would hang an empty plot panel on every flat. */
    default PropertyResponse.Land toLand(Property property) {
        if (LAND_KEYS.stream().noneMatch(key -> answered(formDetail(property, key)))) {
            return null;
        }
        return new PropertyResponse.Land(
                formDetailText(property, "plotZone"),
                formDetailText(property, "waterSource"),
                formDetailText(property, "naStatus"),
                formDetailText(property, "otherRights"),
                formDetailText(property, "buyerEligibility"),
                formDetailText(property, "openSides"),
                formDetailText(property, "roadWidth"),
                formDetailText(property, "plotLength"),
                formDetailText(property, "plotWidth"),
                formDetailBoolean(property, "cornerPlot"),
                formDetailBoolean(property, "boundaryWall"),
                formDetailBoolean(property, "naSanctioned"),
                formDetailBoolean(property, "electricity"),
                formDetailBoolean(property, "roadAccess"),
                formDetailBoolean(property, "satbara"));
    }

    /** The card image: the stored cover, else the first gallery photo. Derived rather than
     * denormalised so it cannot drift from the gallery it is the first frame of. */
    default String coverImage(Property property) {
        String stored = property.getCoverImage();
        if (stored != null && !stored.isBlank()) {
            return stored;
        }
        var images = property.getImages();
        return images == null || images.isEmpty() ? null : images.get(0);
    }

    /** Hand-written back-office projection — null for everyone but staff, and null for listings staff
     * never posted, since an all-false funnel would sit on the board as work that never completes. */
    default PropertyResponse.AdminPipeline toAdminPipeline(Property property,
            @Context BackOfficeVisibility backOffice, @Context OutreachCounts outreach) {
        if (backOffice != BackOfficeVisibility.VISIBLE || property == null
                || !property.isPostedByAdmin()) {
            return null;
        }
        return new PropertyResponse.AdminPipeline(
                true,
                property.getPostedByStaff(),
                outreach.forSubject(property.getId()));
    }

    default ListingProgress toProgress(Property property, @Context BackOfficeVisibility backOffice,
            @Context PrivateFieldVisibility privateFields) {
        return privateFields == PrivateFieldVisibility.VISIBLE
                ? ListingProgress.of(property, backOffice == BackOfficeVisibility.VISIBLE) : null;
    }

    /** Mask a mobile via {@link MobileMask}; anything not a clean 10-digit number becomes null rather
     * than a partial leak. {@code private} so MapStruct cannot apply it to other String fields. */
    private String maskMobile(String mobile) {
        return MobileMask.mask(mobile);
    }
}
