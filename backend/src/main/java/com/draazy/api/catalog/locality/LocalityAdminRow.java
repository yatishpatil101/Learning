package com.draazy.api.catalog.locality;

/** A staff locality list row: the pin and live count the table draws, without the public page's market stats. */
public record LocalityAdminRow(
        String slug,
        String name,
        Double lat,
        Double lng,
        boolean archived,
        long liveListings) {
}
