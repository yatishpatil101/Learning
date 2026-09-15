package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.DealIntent;
import com.draazy.api.catalog.property.Furnishing;
import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.PropertyPossession;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Partial listing update, PATCH semantics: a {@code null} field means "leave unchanged". Foundation
 * fields revert the listing to {@code pending}; server-owned fields are omitted so it cannot self-escalate.
 */
public record ListingUpdate(
        String title,
        @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,
        String propertyType,
        BigDecimal bhk,
        @Positive Long price,
        Long deposit,
        Long maintenance,
        Boolean negotiable,
        BigDecimal area,
        String areaUnit,
        @Pattern(regexp = Furnishing.PATTERN,
                message = Furnishing.PATTERN_MESSAGE) String furnishing,
        String locality,
        String city,
        Double lat,
        Double lng,
        String reraId,
        @Pattern(regexp = PropertyPossession.PATTERN,
                message = PropertyPossession.PATTERN_MESSAGE) String possession,
        List<String> amenities,
        @Size(max = 10) List<String> images,
        String description,
        // Bounded to match ListingCreate; both columns are indexed, and an over-long value is a 500
        // rather than a 422 without this. See the note there.
        @Size(max = 300) String address,
        Integer floor,
        UUID societyId,
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
        /* Absent leaves the stored hashes alone, so a rent change cannot blank the evidence; an
         * empty list is a statement and clears them. Not a foundation field: see ListingCreate. */
        @Size(max = PhotoHash.MAX_PER_LISTING) List<String> photoHashes,
        @Pattern(regexp = "^$|^[1-9][0-9]{5}$") String pincode,
        @Positive BigDecimal carpetArea,
        @Positive BigDecimal builtUpArea,
        @ListingFormDetails Map<String, Object> formDetails) {
}
