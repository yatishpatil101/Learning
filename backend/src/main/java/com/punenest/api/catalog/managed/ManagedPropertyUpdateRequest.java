package com.punenest.api.catalog.managed;

import com.punenest.api.catalog.property.DealIntent;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;
import java.util.Map;

/**
 * Partial-update request for a managed property (contract {@code ManagedPropertyUpdate}). Every
 * field is nullable: only those present are applied (PATCH semantics). Covers both the property
 * facts and the owner-only rent-tracker block (the Rent Panel patches {@code rented}/
 * {@code tenantName}/{@code monthlyRent}/{@code dueDay}).
 *
 * <p>The lifecycle fields ({@code visibility}/{@code status}/{@code publishedListingId}) are not
 * here — they move only through publish, never through a client patch.
 *
 * @param title       new headline, nullable
 * @param deal        buy|rent, nullable
 * @param propertyType type, nullable
 * @param bhk         bedrooms, nullable
 * @param price       amount in whole INR (≥ 0), nullable
 * @param locality    locality name, nullable
 * @param society     society/project name, nullable
 * @param area        built area value, nullable
 * @param areaUnit    area unit, nullable
 * @param furnishing  furnishing level, nullable
 * @param rented      currently rented, nullable
 * @param tenantName  current tenant, nullable
 * @param monthlyRent monthly rent, nullable
 * @param dueDay      rent due day of month, nullable
 * @param valuation   valuation snapshot, nullable
 */
public record ManagedPropertyUpdateRequest(
        String title,
        @Pattern(regexp = DealIntent.PATTERN, message = DealIntent.PATTERN_MESSAGE) String deal,
        String propertyType,
        BigDecimal bhk,
        @PositiveOrZero Long price,
        String locality,
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
