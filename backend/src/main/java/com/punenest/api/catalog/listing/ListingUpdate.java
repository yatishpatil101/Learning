package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Furnishing;
import com.punenest.api.catalog.property.PropertyPossession;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.util.List;

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
 * @param title        headline, nullable
 * @param deal         buy|rent, nullable (foundation field)
 * @param propertyType type, nullable (foundation field)
 * @param bhk          bedroom count, nullable (foundation field)
 * @param price        amount in whole INR, positive when present (foundation field)
 * @param deposit      security deposit, nullable
 * @param maintenance  monthly maintenance, nullable
 * @param area         built area, nullable
 * @param furnishing   furnishing level, nullable
 * @param locality     display locality, nullable (foundation field)
 * @param reraId       MahaRERA id, nullable
 * @param possession   possession state ({@link PropertyPossession}), nullable = not stated
 * @param amenities    amenity labels, nullable
 * @param images       image URLs, nullable
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
        String description) {
}
