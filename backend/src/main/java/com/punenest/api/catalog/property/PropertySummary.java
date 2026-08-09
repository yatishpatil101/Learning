package com.punenest.api.catalog.property;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.Instant;

/**
 * Card projection for search/lists (contract {@code PropertySummary}). This is the lightweight
 * entity↔wire boundary for the catalogue: it deliberately carries <em>no</em> owner contact — search
 * results never expose a phone number (the contact gate lives on the detail path), and the JPA
 * entity is never serialized directly, so internal columns can't leak.
 *
 * @param id           opaque listing id
 * @param slug         URL key (nullable until curated)
 * @param title        listing headline
 * @param deal         buy|rent
 * @param propertyType free-text type (e.g. apartment)
 * @param bhk          bedroom count (whole-number-safe {@link BigDecimal})
 * @param price        amount in whole INR
 * @param priceUnit    {@code total} (buy) or {@code per-month} (rent)
 * @param area         built area value
 * @param areaUnit     area unit (default sqft)
 * @param furnishing   furnishing level, nullable
 * @param possession   possession state ({@link PropertyPossession}), nullable when not stated
 * @param locality     display locality name (the slug is the filter key, not this)
 * @param localitySlug curated locality key (FK to {@code localities.slug}); the value the
 *                     {@code locality} search facet matches on. Nullable when the listing's
 *                     free-text locality resolved to no curated locality.
 * @param coverImage   card image, nullable
 * @param verified     listing "Verified" badge (L2 signal, never a gate)
 * @param postedByType owner|agent|builder, nullable
 * @param status       moderation status (always {@code approved} on public results)
 * @param dealStatus   deal outcome ({@code active|reserved|closed}); {@code reserved} badges a card
 *                     "under offer" without an extra fetch (D110)
 * @param createdAt    row creation time
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PropertySummary(
        String id,
        String slug,
        String title,
        String deal,
        String propertyType,
        BigDecimal bhk,
        Long price,
        String priceUnit,
        BigDecimal area,
        String areaUnit,
        String furnishing,
        String possession,
        String locality,
        String localitySlug,
        String city,
        Double lat,
        Double lng,
        String coverImage,
        boolean verified,
        String postedByType,
        String status,
        String dealStatus,
        Instant createdAt) {
}
