package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.AreaUnit;
import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Furnishing;
import com.draazy.api.catalog.property.LandUse;
import com.draazy.api.catalog.property.PropertyPossession;
import com.draazy.api.catalog.property.PropertyTypeLabel;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Validation rejects invalid client input before a listing can be written. Server-owned fields
 * ({@code status}, {@code owner}, {@code priceUnit}, badges, counters) are absent, so a POST cannot spoof them. */
@CoherentDimensions
@ListingSanityLimits
public record ListingCreate(

        // Public on every card and unread at the contact gate, so it is the cheapest place to leak a
        // phone number. The column is `text`; 200 is several times the longest title the client composes.
        @NotBlank @Size(max = 200) @NoContactDetails String title,
        @NotNull @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,

        @NotBlank @Size(max = 80) @Pattern(regexp = PropertyTypeLabel.PATTERN,
                message = PropertyTypeLabel.PATTERN_MESSAGE) String propertyType,
        BigDecimal bhk,
        @NotNull @Positive Long price,

        // Zero is a statement ("no deposit"); negative is not a smaller deposit, it is a payment.
        @PositiveOrZero Long deposit,
        @PositiveOrZero Long maintenance,
        Boolean negotiable,
        BigDecimal area,
        @Pattern(regexp = AreaUnit.PATTERN, message = AreaUnit.PATTERN_MESSAGE) String areaUnit,
        @Pattern(regexp = Furnishing.PATTERN,
                message = Furnishing.PATTERN_MESSAGE) String furnishing,
        @NotBlank String locality,
        @NotBlank String city,
        Double lat,
        Double lng,

        /** Blank is honest for a listing with none; a malformed id is worse than silence, because the
         * badge it feeds asserts a registry entry a buyer cannot then look up. */
        @Pattern(regexp = "^$|^P[0-9]{11}$",
                message = "must be a MahaRERA id: P followed by 11 digits") String reraId,
        @Pattern(regexp = PropertyPossession.PATTERN,
                message = PropertyPossession.PATTERN_MESSAGE) String possession,

        @Size(max = 5) List<@NotNull @Pattern(regexp = "family|bachelors|bachelor-male|bachelor-female|company|anyone") String> tenants,

        @Size(max = 40) List<@NotNull @Size(max = 60) @NoContactDetails String> amenities,

        @Size(max = 20, message = "cannot carry more than 20 photos")
        List<@NotNull @Size(max = 512) String> images,

        @Size(max = 512) String floorPlan,
        @Pattern(regexp = "^$|^[A-Za-z0-9_-]{11}$") String video,
        @Size(max = 4000) @NoContactDetails String description,

        /** @NotNull on the element, not the list: the write copies with List.copyOf, so `[null]`
         * would be a 500 rather than a 422. Same on the three lists below. */
        @Size(max = 300) @NoContactDetails String address,
        Integer floor,

        /** A claim the verification checklist catches, not a credential. Accepting it is what lets
         * the (society, floor, bhk) duplicate signal fire on a curated id rather than free text. */
        UUID societyId,
        @Size(max = 64) String electricityMeterNo,

        // Optional details do not alter the listing foundation, so edits do not trigger re-moderation.
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
        @ListingFormDetails Map<String, Object> formDetails,

        @Pattern(regexp = LandUse.PATTERN, message = LandUse.PATTERN_MESSAGE)
        String landUse) implements CoherentDimensions.Dimensions, ListingSanityLimits.Input {
}
