package com.punenest.api.catalog.property;

/**
 * The bound facets for {@code GET /properties} (contract {@code searchProperties}). A plain carrier
 * so the controller can hand the whole filter set to {@link PropertyService} without a long
 * parameter list; every field is nullable and means "don't filter" when absent.
 *
 * <p>Reconciliation notes: {@code locality} is a locality <em>slug</em> (matched against
 * {@code locality_slug}), while the response {@link PropertySummary#locality()} is the display name;
 * {@code type} matches {@code property_type} case-insensitively; {@code q} is free-text over
 * title + display locality; {@code bhk} and the price bounds are numeric.
 *
 * @param deal       buy|rent, else null
 * @param type       property type (case-insensitive), else null
 * @param locality   locality slug, else null
 * @param bhk        exact BHK, else null
 * @param minPrice   inclusive lower price bound (whole INR), else null
 * @param maxPrice   inclusive upper price bound (whole INR), else null
 * @param furnishing furnishing enum, else null
 * @param possession possession state ({@link PropertyPossession}), exact match, else null. Deliberately
 *     exact: a null-possession listing means "not stated" and must not satisfy a "ready-to-move" search.
 * @param q          free-text query over title + locality, else null
 * @param status     narrow-within-approved only on the public endpoint (never widens), else null
 */
public record PropertySearchQuery(
        String deal,
        String type,
        String locality,
        Integer bhk,
        Long minPrice,
        Long maxPrice,
        String furnishing,
        String possession,
        String q,
        String status) {
}
