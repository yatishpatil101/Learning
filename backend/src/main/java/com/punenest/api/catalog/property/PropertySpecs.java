package com.punenest.api.catalog.property;

import jakarta.persistence.criteria.Predicate;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

/**
 * Composes the public search predicate from the contract's optional facets. Kept as pure
 * {@link Specification} builders (no state) so {@link PropertyService} can AND them together and let
 * Spring Data render one index-friendly {@code WHERE}.
 *
 * <p>Security invariant baked in here, not left to the caller: the public search <em>always</em>
 * pins {@code archived = false AND status = 'approved'}. The contract exposes a {@code status} query
 * param, but on this anonymous endpoint it can only ever <em>narrow within</em> approved — it can
 * never surface pending/flagged/rejected/archived rows. This forced pair is exactly the predicate of
 * the partial {@code idx_properties_search}.
 */
final class PropertySpecs {

    private PropertySpecs() {
    }

    /**
     * Build the combined search specification for anonymous callers.
     *
     * @param filters the bound query facets (any field may be {@code null} = "don't filter")
     * @return a specification pinned to the public-visibility floor plus the requested facets
     */
    static Specification<Property> publicSearch(PropertySearchQuery filters) {
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();
            // Public-visibility floor — non-negotiable, index-aligned.
            where.add(cb.isFalse(root.get("archived")));
            where.add(cb.equal(root.get("status"), PropertyStatus.APPROVED));
            // A status param can only narrow within approved (an impossible AND yields an empty page).
            if (filters.status() != null && !PropertyStatus.APPROVED.equals(filters.status())) {
                where.add(cb.equal(root.get("status"), filters.status()));
            }
            if (filters.deal() != null) {
                where.add(cb.equal(root.get("deal"), filters.deal()));
            }
            if (StringUtils.hasText(filters.type())) {
                where.add(cb.equal(cb.lower(root.get("propertyType")), filters.type().toLowerCase()));
            }
            if (StringUtils.hasText(filters.locality())) {
                where.add(cb.equal(root.get("localitySlug"), filters.locality()));
            }
            if (filters.bhk() != null) {
                where.add(cb.equal(root.get("bhk"), BigDecimal.valueOf(filters.bhk())));
            }
            if (filters.minPrice() != null) {
                where.add(cb.ge(root.get("price"), filters.minPrice()));
            }
            if (filters.maxPrice() != null) {
                where.add(cb.le(root.get("price"), filters.maxPrice()));
            }
            if (filters.furnishing() != null) {
                where.add(cb.equal(root.get("furnishing"), filters.furnishing()));
            }
            // Exact match, never "null counts as ready": an unrecorded possession is not a promise.
            if (StringUtils.hasText(filters.possession())) {
                where.add(cb.equal(root.get("possession"), filters.possession()));
            }
            if (StringUtils.hasText(filters.q())) {
                String like = "%" + filters.q().toLowerCase() + "%";
                where.add(cb.or(
                        cb.like(cb.lower(root.get("title")), like),
                        cb.like(cb.lower(root.get("locality")), like)));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
    }
}
