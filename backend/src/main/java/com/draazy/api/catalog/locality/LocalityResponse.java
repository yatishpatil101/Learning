package com.draazy.api.catalog.locality;

import java.math.BigDecimal;

/**
 * The contract's {@code Locality} — a locality as it appears in a list.
 *
 * @param slug         URL-safe key and the identity every FK and public URL uses
 * @param listingCount live listings here, computed on read (decision D7.2)
 * @param avgRentPsf   average asking rent per sq ft
 * @param avgBuyPsf    average asking sale price per sq ft
 * @param ratePerSqft  headline buy rate in INR/sq ft
 * @param avgRent      absolute average monthly rent in whole rupees
 * @param demand       demand index, 0-100
 * @param focus        {@code Buy}, {@code Rent} or {@code Both}
 * @param active       whether the locality is shown on the site
 */
public record LocalityResponse(
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
        boolean active) {
}
