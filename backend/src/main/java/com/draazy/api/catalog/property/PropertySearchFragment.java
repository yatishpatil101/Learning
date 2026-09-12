package com.draazy.api.catalog.property;

import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

/**
 * The two reads behind the public listings search (docs/flows/consumer/search-listings.md 9.7); only
 * safe while {@link PropertySpecs#publicSearch} stays a pure {@code WHERE} builder.
 */
interface PropertySearchFragment {

    /**
     * One page of rows in the specification's own order, with <em>no</em> count query. {@code spec}
     * carries the ranking; {@code pageable} must already be through {@link PropertySort}.
     */
    List<Property> findPage(Specification<Property> spec, Pageable pageable);

    /**
     * How many rows match, and how many of those also match {@code subset}, in one statement over
     * one root - which is what makes the two numbers consistent by construction.
     */
    Totals countTotals(Specification<Property> spec, Specification<Property> subset);

    /** {@code subset} is never greater than {@code total}, because it is counted over the same scan. */
    record Totals(long total, long subset) {
    }
}
