package com.draazy.api.catalog.city;

/**
 * The contract's {@code City} record — an entry in the city picker.
 *
 * @param slug         URL-safe key, e.g. {@code pune}
 * @param live         whether the platform actually operates here; a {@code false} city is offered
 *                     only as a waitlist target and must never be presented as transactable
 * @param listingCount live listings in this city, computed on read (decision D7.2) — never the
 *                     unmaintained {@code cities.listing_count} column
 */
public record CityResponse(
        String slug,
        String name,
        boolean live,
        long listingCount) {
}
