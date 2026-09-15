package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Furnishing;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.PropertyPossession;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Validation rejects invalid client input before a listing can be written. Server-owned fields
 * ({@code status}, {@code owner}, {@code priceUnit}, badges, counters) are absent, so a POST cannot spoof them.
 */
public record ListingCreate(
        @NotBlank String title,
        @NotNull @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,
        @NotBlank String propertyType,
        BigDecimal bhk,
        @NotNull @Positive Long price,
        Long deposit,
        Long maintenance,
        Boolean negotiable,
        BigDecimal area,
        String areaUnit,
        @Pattern(regexp = Furnishing.PATTERN,
                message = Furnishing.PATTERN_MESSAGE) String furnishing,
        @NotBlank String locality,
        @NotBlank String city,
        Double lat,
        Double lng,
        String reraId,
        @Pattern(regexp = PropertyPossession.PATTERN,
                message = PropertyPossession.PATTERN_MESSAGE) String possession,
        List<String> amenities,
        @Size(max = 10) List<String> images,
        String description,
        /* Bounded because this and electricityMeterNo land in btree indexes: Postgres refuses an
         * entry over ~2704 bytes, which is a 500 — a denial of service costing one long string. */
        @Size(max = 300) String address,
        Integer floor,
        /* A claim the verification checklist catches, not a credential. Accepting it is what lets
         * the (society, floor, bhk) duplicate signal fire on a curated id rather than free text. */
        UUID societyId,
        @Size(max = 64) String electricityMeterNo,
        // Optional details do not alter the listing foundation, so edits do not trigger re-moderation.
        @Min(0) Integer bathrooms,
        @Min(0) Integer parking,
        @Min(0) Integer balconies,
        /* Bounded rather than enumerated, so an edit preserves legacy direction values outside the
         * four-option compass picker. */
        @Size(max = 32) String facing,
        // A home has a view independently of its compass direction.
        @Size(max = 32) String overlooking,
        @Min(1) Integer totalFloors,
        // The wizard sends the age band's lower bound; null is unstated, not a new building.
        @Min(0) Integer ageYears,
        /* Perceptual hashes computed in the browser, because hashing pixels needs a canvas.
         * Unvalidated beyond the cap: an owner cannot see or correct one, and the cap bounds rows. */
        @Size(max = PhotoHash.MAX_PER_LISTING) List<String> photoHashes,
        @Pattern(regexp = "^$|^[1-9][0-9]{5}$") String pincode,
        @Positive BigDecimal carpetArea,
        @Positive BigDecimal builtUpArea,
        @ListingFormDetails Map<String, Object> formDetails) {
}
