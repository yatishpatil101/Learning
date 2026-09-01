package com.punenest.api.catalog.locality;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

/**
 * Body of {@code POST /admin/localities} — add an area to the curated reference table.
 *
 * <p><strong>{@code slug} is optional and is the one field worth explaining.</strong> Left out, the
 * server coins it from {@code name} with the same {@code slugify} the resolver uses, which is what
 * makes a locality created here immediately resolvable from the free text owners actually type. Sent
 * explicitly, it is honoured verbatim — the escape hatch for the names where a naive slugify is
 * wrong ("NIBM Road" wants {@code nibm-road}, and a curator who has already published a URL cannot
 * have it recomputed under them). It can never be changed afterwards; see {@link Locality}.
 *
 * <p>The price signals are all optional. A locality is created the day somebody notices listings
 * arriving from it, and priced once there are enough of them to average — requiring
 * {@code avgRentPsf} up front would only teach curators to type a zero.
 *
 * @param slug        optional explicit key; coined from {@code name} when absent
 * @param name        display name, the only thing a curator must decide
 * @param city        the city this area sits in
 * @param avgRentPsf  average asking rent per sq ft
 * @param avgBuyPsf   average asking sale price per sq ft
 * @param ratePerSqft headline buy rate in INR/sq ft
 * @param avgRent     absolute average monthly rent in whole rupees
 * @param demand      demand index 0-100, matching the column's CHECK constraint
 * @param focus       {@code Buy}, {@code Rent} or {@code Both}
 * @param lat         latitude, used by the resolver's geo-snap fallback
 * @param lng         longitude
 */
public record LocalityCreateRequest(
        @Pattern(regexp = "[a-z0-9]+(-[a-z0-9]+)*",
                message = "slug must be lowercase words separated by single hyphens")
        @Size(max = 120) String slug,
        @NotBlank @Size(max = 120) String name,
        @NotBlank @Size(max = 80) String city,
        @DecimalMin("0.0") BigDecimal avgRentPsf,
        @DecimalMin("0.0") BigDecimal avgBuyPsf,
        @DecimalMin("0.0") BigDecimal ratePerSqft,
        @PositiveOrZero Long avgRent,
        @Min(0) @Max(100) Integer demand,
        @Pattern(regexp = "Buy|Rent|Both") String focus,
        @DecimalMin("-90.0") Double lat,
        @DecimalMin("-180.0") Double lng) {
}
