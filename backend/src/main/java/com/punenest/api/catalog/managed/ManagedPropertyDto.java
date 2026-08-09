package com.punenest.api.catalog.managed;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Map;

/**
 * Read shape for a managed property (contract {@code ManagedProperty}). Carries the owner-captured
 * facts, the owner-only rent-tracker block and the lifecycle/link fields; presentation strings
 * (formatted price, gallery, "society, locality, Pune" line) are derived on the client, so the wire
 * stays the source data rather than a rendered card.
 *
 * <p>{@code deal} is the catalogue's {@code buy|rent} value; the front-end seam translates it to its
 * own {@code sale|rent} display label. {@code publishedListingId} is {@code null} until the record
 * is published, at which point it is the id of the spawned listing.
 */
public record ManagedPropertyDto(
        String id,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        String locality,
        String localitySlug,
        String society,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        String visibility,
        String status,
        boolean rented,
        String tenantName,
        Long monthlyRent,
        Integer dueDay,
        Map<String, Object> valuation,
        String publishedListingId,
        Instant createdAt,
        Instant updatedAt) {
}
