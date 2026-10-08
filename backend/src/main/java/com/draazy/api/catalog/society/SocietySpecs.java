package com.draazy.api.catalog.society;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyStatus;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.data.jpa.domain.Specification;

/** A {@link Specification} avoids a derived-query method per filter combination, as in {@code PropertySpecs}. */
public final class SocietySpecs {

    private SocietySpecs() {
    }

    /** {@code findAll} only, never delete-by-Specification (societies.md section 9.5). */
    public static Specification<Society> browse(
            String q, String localitySlug, Boolean hasListings) {
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();

            // Merged-away duplicates are not results, and not a caller-supplied flag: listing both
            // splits one building's listings, followers and reviews across two cards.
            where.add(cb.isNull(root.get("mergedInto")));
            where.add(cb.isNull(root.get("archivedAt")));

            if (likePattern(q) != null) {
                where.add(cb.like(cb.lower(searchText(root, cb)), likePattern(q)));
            }
            if (trimmed(localitySlug) != null) {
                where.add(cb.equal(root.get("localitySlug"), trimmed(localitySlug)));
            }
            if (Boolean.TRUE.equals(hasListings)) {
                where.add(cb.exists(hasLiveListing(root, query, cb)));
            }
            return cb.and(where.toArray(new Predicate[0]));
        };
    }

    /** The lower-cased {@code LIKE} pattern for a free-text query, or null when there is none. */
    public static String likePattern(String q) {
        return q == null || q.isBlank() ? null : "%" + q.trim().toLowerCase(Locale.ROOT) + "%";
    }

    /** The locality filter value, or null when blank. */
    public static String trimmed(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    /** Name, builder and the locality as words ("baner-road" is "baner road"), so a typed query finds all three. */
    private static Expression<String> searchText(Root<Society> root, CriteriaBuilder cb) {
        Expression<String> locality = cb.function("replace", String.class,
                cb.coalesce(root.<String>get("localitySlug"), ""), cb.literal("-"), cb.literal(" "));
        Expression<String> builder = cb.coalesce(root.<String>get("builder"), "");
        return cb.concat(cb.concat(cb.concat(cb.concat(root.<String>get("name"), " "), builder), " "), locality);
    }

    /** The second root is the merge family, and it is load-bearing: societies.md section 9.4. */
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
