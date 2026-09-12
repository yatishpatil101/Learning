package com.draazy.api.catalog.society;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyStatus;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.data.jpa.domain.Specification;

/**
 * The {@code GET /societies} filter, composed as a {@link Specification} rather than a derived-query
 * method per combination — the same choice, for the same reason, as {@code PropertySpecs}.
 */
public final class SocietySpecs {

    private SocietySpecs() {
    }

    /**
     * Free-text over name and builder plus optional locality, over societies that still stand alone.
     * <strong>{@code findAll} only, never delete-by-Specification</strong> - societies.md section 9.5.
     */
    public static Specification<Society> browse(String q, String localitySlug, Boolean hasListings) {
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();

            // Merged-away duplicates are not results, and not a caller-supplied flag: listing both
            // splits one building's listings, followers and reviews across two cards.
            where.add(cb.isNull(root.get("mergedInto")));

            if (q != null && !q.isBlank()) {
                String like = "%" + q.trim().toLowerCase(Locale.ROOT) + "%";
                where.add(cb.or(
                        cb.like(cb.lower(root.get("name")), like),
                        cb.like(cb.lower(root.get("builder")), like)));
            }
            if (localitySlug != null && !localitySlug.isBlank()) {
                where.add(cb.equal(root.get("localitySlug"), localitySlug.trim()));
            }
            if (Boolean.TRUE.equals(hasListings)) {
                where.add(cb.exists(hasLiveListing(root, query, cb)));
            }
            return cb.and(where.toArray(new Predicate[0]));
        };
    }

    /**
     * "Does this society have at least one live listing?", as a correlated {@code EXISTS}. <strong>The
     * second root is the merge family, and it is load-bearing</strong>: societies.md section 9.4.
     */
    private static Subquery<Integer> hasLiveListing(
            Root<Society> society, CriteriaQuery<?> query, CriteriaBuilder cb) {
        Subquery<Integer> sub = query.subquery(Integer.class);
        Root<Property> listing = sub.from(Property.class);
        Root<Society> owner = sub.from(Society.class);
        return sub.select(cb.literal(1)).where(
                cb.equal(owner.get("id"), listing.get("societyId")),
                cb.or(
                        cb.equal(owner.get("id"), society.get("id")),
                        cb.equal(owner.get("mergedInto"), society.get("id"))),
                cb.equal(listing.get("status"), PropertyStatus.APPROVED),
                cb.isFalse(listing.get("archived")));
    }
}
