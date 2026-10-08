package com.draazy.api.catalog.listing;

import jakarta.validation.constraints.Size;

/** Same fields and size limits as {@link ListingCreate}, so the check derives the exact key a create would;
 * the limits keep over-long values from causing a 500 at the btree index (V79). */
public record ListingDuplicateCheck(
        @Size(max = 300) String address,
        String locality,
        String localitySlug,
        String city,
        Double lat,
        Double lng,
        @Size(max = 64) String electricityMeterNo) {
}
