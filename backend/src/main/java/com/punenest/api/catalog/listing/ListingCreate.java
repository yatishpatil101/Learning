package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Furnishing;
import com.punenest.api.catalog.property.PropertyPossession;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.util.List;

/**
 * Create-a-listing request (contract {@code ListingCreate}). Validation mirrors the spec's
 * {@code required} set and the enum constraints, so a bad body fails fast at the controller with a
 * {@code 422} before any business logic runs.
 *
 * <p>Deliberately absent (server-owned, never client-supplied — prevents self-escalation / spoofing):
 * {@code status} (forced {@code pending}), {@code owner} (the authenticated caller),
 * {@code priceUnit} (derived from {@code deal}), {@code postedByType} (defaulted {@code owner}),
 * {@code verified}/{@code featured}/counters. Money fields are whole INR ({@code Long}); {@code bhk}
 * and areas are numeric.
 *
 * @param title        headline (required)
 * @param deal         buy|rent (required)
 * @param propertyType free-text type (required)
 * @param bhk          bedroom count, nullable
 * @param price        amount in whole INR (required, positive)
 * @param deposit      security deposit (rent), nullable
 * @param maintenance  monthly maintenance, nullable
 * @param negotiable   price negotiable flag, nullable
 * @param area         built area value, nullable
 * @param areaUnit     area unit, defaults sqft when null
 * @param furnishing   furnishing level, nullable
 * @param locality     display locality name (required)
 * @param city         city (required)
 * @param lat          latitude, nullable
 * @param lng          longitude, nullable
 * @param reraId       MahaRERA id, nullable
 * @param possession   possession state ({@link PropertyPossession}), nullable = not stated
 * @param amenities    amenity labels, nullable
 * @param images       image URLs, nullable
 * @param description  free-text description, nullable
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
        List<String> images,
        String description) {
}
