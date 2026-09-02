package com.draazy.api.catalog.locality;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/**
 * Body of {@code PATCH /admin/localities/{slug}} — correct a curated area.
 *
 * <p>Every field is nullable and {@code null} means "leave alone", the same sparse-patch convention
 * {@code ListingUpdate} uses. That is why {@code active} is a {@link Boolean} rather than a
 * {@code boolean}: a primitive would default to {@code false}, so a curator fixing a typo in
 * {@code name} would silently retire the locality and take its landing page off the site.
 *
 * <p>There is no {@code slug}. It is the primary key three foreign keys and every public URL point
 * at — see {@link Locality}.
 *
 * @param name        display name; renaming is safe, the slug does not follow
 * @param city        the city this area sits in
 * @param avgRentPsf  average asking rent per sq ft
 * @param avgBuyPsf   average asking sale price per sq ft
 * @param ratePerSqft headline buy rate in INR/sq ft
 * @param avgRent     absolute average monthly rent in whole rupees
 * @param demand      demand index 0-100
 * @param focus       {@code Buy}, {@code Rent} or {@code Both}
 * @param lat         latitude
 * @param lng         longitude
 * @param active      {@code false} retires the locality; see {@code DELETE} for the same effect
 */
public record LocalityUpdateRequest(
        @Size(max = 120) String name,
        @Size(max = 80) String city,
        @DecimalMin("0.0") BigDecimal avgRentPsf,
        @DecimalMin("0.0") BigDecimal avgBuyPsf,
        @DecimalMin("0.0") BigDecimal ratePerSqft,
        @PositiveOrZero Long avgRent,
        @Min(0) @Max(100) Integer demand,
        @Pattern(regexp = "Buy|Rent|Both") String focus,
        @DecimalMin("-90.0") Double lat,
        @DecimalMin("-180.0") Double lng,
        Boolean active) {
}
