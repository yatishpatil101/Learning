package com.punenest.api.catalog.property;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import java.math.BigDecimal;
import java.time.Instant;
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
 *
 * <p>{@link #adminSearch} is the deliberate counterpart, and the only builder in the codebase that
 * omits the floor. It is a <em>separate method</em> rather than a {@code boolean includeAll} flag on
 * {@link #publicSearch} on purpose: a flag would make the public search one mistyped argument away
 * from serving unapproved listings anonymously, whereas a second method can only be reached by a
 * caller who named it, and every caller can be enumerated by grep. Its one caller is a route behind
 * {@code @PreAuthorize(staff|admin)}.
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
            List<Predicate> where = facets(filters, root, cb);
            // Public-visibility floor — non-negotiable, index-aligned.
            where.add(cb.isFalse(root.get("archived")));
            where.add(cb.equal(root.get("status"), PropertyStatus.APPROVED));
            // A status param can only narrow within approved (an impossible AND yields an empty page).
            if (filters.status() != null && !PropertyStatus.APPROVED.equals(filters.status())) {
                where.add(cb.equal(root.get("status"), filters.status()));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
    }

    /**
     * Ordering-only specification that floats currently-promoted listings to the top (D59).
     *
     * <p><strong>Filters nothing.</strong> It returns a {@code null} predicate and contributes only
     * an {@code ORDER BY}, so it composes with {@link #publicSearch} without changing which rows
     * come back — a boost buys position, never visibility. It is applied by
     * {@link PropertyService#search} <em>only</em> when the caller did not ask for a specific order:
     * a buyer who sorts by price low-to-high gets price low-to-high, because silently pinning paid
     * listings above a sort the buyer explicitly chose is a lie about what the control does.
     *
     * <p>The rank is computed as {@code boosted_until > now} rather than read as a flag, so an
     * elapsed window stops promoting the moment it elapses and correctness never depends on a
     * sweeper having run. The trailing {@code created_at DESC} preserves today's default order
     * within each rank, so an unboosted catalogue is ordered exactly as it was before this existed.
     *
     * @param now the instant to measure the promotion window against; passed in rather than taken
     *     inside so a test can place a window on either side of it deterministically
     */
    static Specification<Property> boostedFirst(Instant now) {
        return (root, query, cb) -> {
            // Spring Data issues a separate COUNT query for the page total. An ORDER BY there is
            // both useless and, on a count over a grouped/distinct shape, invalid SQL.
            if (query != null && !Long.class.equals(query.getResultType())) {
                query.orderBy(
                        cb.desc(cb.selectCase()
                                .when(cb.greaterThan(root.get("boostedUntil"), now), 1)
                                .otherwise(0)),
                        cb.desc(root.get("createdAt")),
                        // Same total-order guarantee PropertySort appends to the sorted branch, and
                        // for the same reason: neither the rank nor created_at is unique, and this
                        // branch is paged. Two listings posted in the same instant would otherwise
                        // be ordered by whatever the planner picked for that particular query, so a
                        // reader paging through could see one of them twice and never see the other.
                        cb.desc(root.get("id")));
            }
            return null; // ordering only — no restriction to add
        };
    }

    /**
     * Build the moderation search: the same facets with <strong>no visibility floor at all</strong>,
     * so pending, rejected, flagged and archived listings are reachable.
     *
     * <p>{@code status} here <em>widens</em> rather than narrows — that asymmetry with
     * {@link #publicSearch} is the entire point of the method. An unfiltered call returns every row
     * in the table, which is what a moderation queue is.
     *
     * @param filters  the bound query facets; {@code status} is an exact match when present
     * @param archived tri-state: {@code null} = both, {@code true} = archived only,
     *     {@code false} = live only. Tri-state rather than a plain boolean because "show me
     *     everything" and "show me only the un-archived" are different questions, and a two-valued
     *     flag can only ask one of them.
     * @param recheck  tri-state on the same reasoning: {@code true} is the stays-live re-check queue
     *     (Q14) — listings whose owner edited price/furnishing/possession and which are waiting for
     *     a moderator while still approved and still in search. A third axis rather than a status
     *     value precisely because every status but {@code approved} is off search.
     * @return a specification with no visibility floor — <strong>staff/admin routes only</strong>
     */
    static Specification<Property> adminSearch(PropertySearchQuery filters, Boolean archived,
            Boolean recheck) {
        return (root, query, cb) -> {
            List<Predicate> where = facets(filters, root, cb);
            if (filters.status() != null) {
                where.add(cb.equal(root.get("status"), filters.status()));
            }
            if (archived != null) {
                where.add(archived ? cb.isTrue(root.get("archived")) : cb.isFalse(root.get("archived")));
            }
            if (recheck != null) {
                where.add(recheck
                        ? cb.isNotNull(root.get("recheckRequestedAt"))
                        : cb.isNull(root.get("recheckRequestedAt")));
            }
            // An unfiltered moderation query is legal and means "everything"; `cb.and()` over an
            // empty array is a vacuous truth in JPA, but conjunction() says so explicitly.
            return where.isEmpty() ? cb.conjunction() : cb.and(where.toArray(Predicate[]::new));
        };
    }

    /**
     * The facets both searches share. Status, archived and recheck are deliberately <em>not</em>
     * here: they are the axes on which the public and moderation reads differ, so keeping them at
     * the call sites means neither can be changed by accident while editing a price or locality
     * filter.
     */
    private static List<Predicate> facets(PropertySearchQuery filters, Root<Property> root,
            CriteriaBuilder cb) {
        List<Predicate> where = new ArrayList<>();
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
        return where;
    }
}
