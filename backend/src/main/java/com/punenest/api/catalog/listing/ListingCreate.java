package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.property.DealIntent;
import com.punenest.api.catalog.property.Furnishing;
import com.punenest.api.catalog.property.PropertyPossession;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

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
 * @param deal         buy|rent (required)
 * @param propertyType free-text type (required)
 * @param price        amount in whole INR (required, positive)
 * @param deposit      security deposit (rent), nullable
 * @param maintenance  monthly maintenance, nullable
 * @param area         built area value, nullable
 * @param areaUnit     area unit, defaults sqft when null
 * @param reraId       MahaRERA id, nullable
 * @param possession   possession state ({@link PropertyPossession}), nullable = not stated
 * @param images       image URLs, nullable
 * @param address      street address, nullable; normalised server-side into the duplicate key (V79)
 * @param floor        which floor the unit is on, nullable; part of the society duplicate signal
 * @param societyId    the society this unit sits in, nullable
 * @param electricityMeterNo the unit's meter number, nullable; never returned to the public
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
        String description,
        /* Bounded because both this and electricityMeterNo land in btree indexes (V79). Postgres
         * refuses an index entry over ~2704 bytes, and the refusal surfaces as a 500 on a route any
         * authenticated account can call — a denial of service that costs one long string. The
         * limits are generous against a real Indian address and a real MSEDCL consumer number. */
        @Size(max = 300) String address,
        Integer floor,
        /* A claim, not a credential. Pointing a listing at a society the owner is not in is exactly
         * the sort of thing the verification checklist exists to catch, and it is already visible to
         * a moderator in the society name on the case file. Accepting it is what lets the
         * (society, floor, bhk) duplicate signal fire at all — a signal whose whole value is that
         * society_id is a curated id rather than free text, so it cannot be fudged by spelling. */
        UUID societyId,
        @Size(max = 64) String electricityMeterNo) {
}
