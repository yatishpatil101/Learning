package com.punenest.api.catalog.locality;

import java.math.BigDecimal;
import java.util.List;

/**
 * The contract's {@code LocalityDetail} — everything in {@link LocalityResponse} plus the narrative
 * fields the locality page shows.
 *
 * <p>The spec composes this with {@code allOf}; a record cannot extend another record, so the base
 * fields are repeated here. That is a flattening of the same document, not a second one.
 *
 * <p><strong>No {@code listingsList}.</strong> The frontend mock returns one, but the contract does
 * not, and {@code Locality.jsx} already fetches the listings separately through
 * {@code listProperties({locality})} — so adding it would duplicate a call the page makes anyway,
 * and would put an unpaged property array inside an unauthenticated response.
 *
 * @param about        editorial copy; empty until authored (see {@link Locality#getAbout()})
 * @param connectivity transit and landmark notes
 * @param highlights   short selling points
 * @param priceTrends  monthly price history, oldest first as stored
 */
public record LocalityDetailResponse(
        String slug,
        String name,
        String city,
        long listingCount,
        BigDecimal avgRentPsf,
        BigDecimal avgBuyPsf,
        BigDecimal ratePerSqft,
        Long avgRent,
        Integer demand,
        String focus,
        Double lat,
        Double lng,
        boolean active,
        String about,
        List<String> connectivity,
        List<String> highlights,
        List<PriceTrendPoint> priceTrends) {
}
