package com.draazy.api.catalog.property;

import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

/** Only safe while {@link PropertySpecs#publicSearch} stays a pure {@code WHERE} builder. */
interface PropertySearchFragment {

    /** No count query; {@code spec} carries the ranking and {@code pageable} must already be through {@link PropertySort}. */
    List<Property> findPage(Specification<Property> spec, Pageable pageable);

    /** One statement over one root, which is what makes all three numbers consistent by construction. */
    Totals countTotals(Specification<Property> spec, Specification<Property> verified,
            Specification<Property> unstated);

    /** Neither subset is ever greater than {@code total}: all three are counted over the same scan. */
    record Totals(long total, long verified, long unstated) {
    }
}
