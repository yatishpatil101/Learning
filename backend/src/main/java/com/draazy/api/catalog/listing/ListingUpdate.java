package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.AreaUnit;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Furnishing;
import com.draazy.api.catalog.property.LandUse;
import com.draazy.api.catalog.property.PropertyPossession;
import com.draazy.api.catalog.property.PropertyTypeLabel;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/** Partial listing update, PATCH semantics: {@code null} means "leave unchanged". Cross-field coherence sees
 * only what this body states, so a pair split across two PATCHes is caught only when submitted together. */
@CoherentDimensions
@ListingSanityLimits
public record ListingUpdate(
        @Size(max = 200) @NoContactDetails String title,
        @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,

        // Guarded as on the POST: an unreadable label is not rejected, it is unfindable, and re-labelling
        // is exactly where that happens. Null still means "leave unchanged" — @Pattern does not fire on it.
        @Size(max = 80) @Pattern(regexp = PropertyTypeLabel.PATTERN,
                message = PropertyTypeLabel.PATTERN_MESSAGE) String propertyType,
        BigDecimal bhk,
        @Positive Long price,
        @PositiveOrZero Long deposit,
        @PositiveOrZero Long maintenance,
        Boolean clearMaintenance,
        Boolean negotiable,
        BigDecimal area,
        @Pattern(regexp = AreaUnit.PATTERN, message = AreaUnit.PATTERN_MESSAGE) String areaUnit,
        @Pattern(regexp = Furnishing.PATTERN,
                message = Furnishing.PATTERN_MESSAGE) String furnishing,
        String locality,
        String localitySlug,
        String city,
        Double lat,
        Double lng,
        @Pattern(regexp = "^$|^P[0-9]{11}$",
                message = "must be a MahaRERA id: P followed by 11 digits") String reraId,
        @Pattern(regexp = PropertyPossession.PATTERN,
                message = PropertyPossession.PATTERN_MESSAGE) String possession,
        @Size(max = 5) List<@NotNull @Pattern(regexp = "family|bachelors|bachelor-male|bachelor-female|company|anyone") String> tenants,

        // Bounded, contact-guarded and null-free to match ListingCreate; see the notes there.
        @Size(max = 40) List<@NotNull @Size(max = 60) @NoContactDetails String> amenities,

        @Size(max = 20, message = "cannot carry more than 20 photos") List<@NotNull @Size(max = 512) String> images,

        @Size(max = 512) String floorPlan,
        @Pattern(regexp = "^$|^[A-Za-z0-9_-]{11}$") String video,
        @Size(max = 4000) @NoContactDetails String description,

        @Size(max = 300) @NoContactDetails String address,
        Integer floor,
        @Pattern(regexp = "^$|^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$") String societyId,
        @Size(max = 64) String electricityMeterNo,

        // Match ListingCreate's bounds to preserve legacy values rather than enforce picker options.
        // These details are non-foundation fields, so edits do not trigger server re-review.
        @Min(0) Integer bathrooms,
        @Min(0) Integer parking,
        @Min(0) Integer balconies,
        @Size(max = 32) String facing,
        @Size(max = 32) String overlooking,
        @Min(1) Integer totalFloors,
        @Min(0) Integer ageYears,
        @Pattern(regexp = "^$|^[1-9][0-9]{5}$") String pincode,
        @Positive BigDecimal carpetArea,
        @Positive BigDecimal builtUpArea,
        @Positive BigDecimal superBuiltUpArea,

        @Pattern(regexp = "^$|now|15|30") String availableFrom,
        Boolean pets,

        // Absent `pets` cannot mean "withdraw", so returning to unstated needs its own word.
        Boolean clearPets,
        @ListingFormDetails Map<String, Object> formDetails,

        @Pattern(regexp = LandUse.PATTERN, message = LandUse.PATTERN_MESSAGE)
        String landUse,

        Boolean clearLandUse) implements CoherentDimensions.Dimensions, ListingSanityLimits.Input {
}
