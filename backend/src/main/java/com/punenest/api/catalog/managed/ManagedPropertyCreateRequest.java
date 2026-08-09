package com.punenest.api.catalog.managed;

import com.punenest.api.catalog.property.DealIntent;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;
import java.util.Map;

/**
 * Register-a-managed-property request (contract {@code ManagedPropertyCreate}). Validation fails
 * fast at the controller with a {@code 422} before any business logic runs.
 *
 * <p>Deliberately absent (server-owned, never client-supplied): {@code visibility}/{@code status}
 * (forced private/managed), {@code owner} (the authenticated caller), {@code publishedListingId}
 * (set only by publish). {@code title} is optional — when blank the server synthesizes one from
 * bhk/type/locality, mirroring the front end's Rent-o-meter.
 *
 * <p>{@code deal} uses the catalogue's {@code buy|rent} vocabulary so a later publish is a straight
 * pass-through. {@code price} is whole INR; {@code monthlyRent} defaults to {@code price} for a rent
 * deal when omitted.
 *
 * @param title       optional headline; synthesized when blank
 * @param deal        buy|rent (required)
 * @param propertyType free-text type (required)
 * @param bhk         bedrooms, nullable
 * @param price       amount in whole INR (required, ≥ 0)
 * @param locality    locality name (required)
 * @param society     society/project name, nullable
 * @param area        built area value, nullable
 * @param areaUnit    area unit, defaults sqft when null
 * @param furnishing  furnishing level, nullable
 * @param rented      owner rent-tracker: currently rented, nullable (defaults false)
 * @param tenantName  current tenant, nullable
 * @param monthlyRent monthly rent for the tracker, nullable
 * @param dueDay      rent due day of month, nullable
 * @param valuation   opaque Rent-o-meter valuation snapshot, nullable
 */
public record ManagedPropertyCreateRequest(
        String title,
        @NotNull @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,
        @NotBlank String propertyType,
        BigDecimal bhk,
        @NotNull @PositiveOrZero Long price,
        @NotBlank String locality,
        String society,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        Boolean rented,
        String tenantName,
        Long monthlyRent,
        Integer dueDay,
        Map<String, Object> valuation) {
}
