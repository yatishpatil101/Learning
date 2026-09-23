package com.draazy.api.catalog.property;

// Every field is nullable and means "don't filter" when absent; `locality` is a slug, not the
// display name, and `possession` is exact so a "not stated" listing never satisfies a state filter.
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
        String status,
        String owner) {
}
