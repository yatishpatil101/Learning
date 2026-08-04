package com.punenest.api.catalog.society;

import jakarta.persistence.criteria.Predicate;
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
     * Free-text over name and builder, plus an optional locality slug.
     *
     * <p>The text match is a leading-wildcard {@code LIKE}, which no btree index can serve. That is
     * acceptable here and only here: {@code societies} is a curated directory in the thousands of
     * rows, the scan is bounded by the page-size cap, and the alternative — a trigram index or
     * full-text column — is a schema change this slice does not need. If the RERA bulk import
     * (~320k statewide records) is ever loaded, this becomes a {@code pg_trgm} index instead, and
     * that is the trigger to watch for.
     */
    public static Specification<Society> browse(String q, String localitySlug) {
        return (root, query, cb) -> {
            List<Predicate> where = new ArrayList<>();

            if (q != null && !q.isBlank()) {
                String like = "%" + q.trim().toLowerCase(Locale.ROOT) + "%";
                where.add(cb.or(
                        cb.like(cb.lower(root.get("name")), like),
                        cb.like(cb.lower(root.get("builder")), like)));
            }
            if (localitySlug != null && !localitySlug.isBlank()) {
                where.add(cb.equal(root.get("localitySlug"), localitySlug.trim()));
            }
            return where.isEmpty() ? cb.conjunction() : cb.and(where.toArray(new Predicate[0]));
        };
    }
}
