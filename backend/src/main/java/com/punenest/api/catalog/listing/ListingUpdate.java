package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Furnishing;
import com.punenest.api.catalog.property.PropertyPossession;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Partial listing update (contract {@code ListingUpdate} — {@code allOf ListingCreate} with every
 * field optional, PATCH semantics). A {@code null} field means "leave unchanged"; only fields the
 * client actually sends are applied.
 *
 * <p>The foundation fields — {@code price}, {@code bhk}, {@code propertyType}, {@code locality},
 * {@code deal} — are the ones whose change reverts the listing to {@code pending} for re-moderation
 * (enforced in the service, per the domain rule; ADR-019 trust). Server-owned fields
 * ({@code status}/{@code owner}/counters/badges) are omitted so a PATCH can't self-escalate.
 *
 * @param deal         buy|rent, nullable (foundation field)
 * @param bhk          bedroom count, nullable (foundation field)
 * @param price        amount in whole INR, positive when present (foundation field)
 * @param deposit      security deposit, nullable
 * @param maintenance  monthly maintenance, nullable
 * @param area         built area, nullable
 * @param locality     display locality, nullable (foundation field)
 * @param reraId       MahaRERA id, nullable
 * @param possession   possession state ({@link PropertyPossession}), nullable = not stated
 * @param images       image URLs, nullable
 * @param address      street address, nullable; re-normalised into the duplicate key on every write
 * @param floor        which floor the unit is on, nullable
 * @param societyId    the society this unit sits in, nullable
 * @param electricityMeterNo the unit's meter number, nullable; never returned to the public
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
        List<String> images,
        String description,
        // Bounded to match ListingCreate; both columns are indexed, and an over-long value is a 500
        // rather than a 422 without this. See the note there.
        @Size(max = 300) String address,
        Integer floor,
        UUID societyId,
        @Size(max = 64) String electricityMeterNo,
        // Mirrors ListingCreate; see the notes there for why facing is bounded rather than
        // enumerated and why ageYears is a band lower bound. All five are non-foundation: editing
        // any of them leaves the listing live, because none of them is a thing the moderator
        // approved. That is why none appears in the tier sets in ListingEditRules.
        @Min(0) Integer bathrooms,
        @Min(0) Integer parking,
        @Min(0) Integer balconies,
        @Size(max = 32) String facing,
        @Min(1) Integer totalFloors,
        @Min(0) Integer ageYears) {
}
