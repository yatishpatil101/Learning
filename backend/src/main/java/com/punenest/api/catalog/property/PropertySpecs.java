package com.punenest.api.catalog.property;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
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
        return publicSearch(filters, ListingFacets.NONE);
    }

    /**
     * Build the combined search specification for anonymous callers, including the buyer-facing
     * facets the results page offers (D26).
     *
     * @param filters the bound query facets (any field may be {@code null} = "don't filter")
     * @param extra   the listings-page facets; {@link ListingFacets#NONE} to apply none
     * @return a specification pinned to the public-visibility floor plus the requested facets
     */
    static Specification<Property> publicSearch(PropertySearchQuery filters, ListingFacets extra) {
        return (root, query, cb) -> {
            List<Predicate> where = facets(filters, root, cb);
            listingFacets(extra, root, cb, where);
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
     * The default order for the listings results page: paid placement first, then editorial merit
     * (D26).
     *
     * <p><strong>Filters nothing</strong>, exactly like {@link #boostedFirst}, and applied under
     * the same rule — only when the buyer expressed no preference. A boost and a good score both
     * buy position, never visibility, and neither may outrank an order the buyer actually chose.
     *
     * <p>The score reproduces what the browser called {@code relevanceScore}, term for term:
     * <pre>
     *   featured             1000
     *   owner verified        250
     *   ownership verified    200
     *   RERA registered        80
     *   freshness       200 / 120 / 40 / 0   (active / aging / stale / dormant)
     *   + quality_score    0 .. 100          (generated, V94)
     * </pre>
     * The weights are spaced so each tier dominates the sum of everything beneath it: a featured
     * listing outranks a perfect unfeatured one, and no amount of completeness substitutes for a
     * verification. That was the intent of the original numbers, and preserving it is the reason
     * they are transcribed rather than re-derived.
     *
     * <p>Freshness is computed here from timestamps rather than read from a column because it
     * cannot be one — it is a function of the clock, so any stored tier is correct only at the
     * instant it was written. {@link Freshness} states the same boundaries for the response; the
     * cutoffs are derived from the same constants so the badge a buyer sees and the rank that put
     * the listing in front of them can never disagree.
     *
     * @param now the instant every window is measured against; passed in so a test can place a
     *     listing on either side of a boundary deterministically
     */
    static Specification<Property> relevanceFirst(Instant now) {
        return (root, query, cb) -> {
            if (query != null && !Long.class.equals(query.getResultType())) {
                Expression<Instant> since = cb.coalesce(root.get("lastConfirmedAt"), root.get("createdAt"));
                Expression<Integer> freshness = cb.<Integer>selectCase()
                        .when(cb.greaterThanOrEqualTo(since, now.minus(Duration.ofDays(Freshness.FRESH_DAYS))), 200)
                        .when(cb.greaterThanOrEqualTo(since, now.minus(Duration.ofDays(Freshness.AGING_DAYS))), 120)
                        .when(cb.greaterThanOrEqualTo(since, now.minus(Duration.ofDays(Freshness.STALE_DAYS))), 40)
                        .otherwise(0);
                Expression<Integer> score = cb.sum(cb.sum(cb.sum(cb.sum(cb.sum(
                        weight(cb.isTrue(root.get("featured")), 1000, cb),
                        weight(cb.isTrue(root.get("ownerVerified")), 250, cb)),
                        weight(cb.isTrue(root.get("ownershipVerified")), 200, cb)),
                        weight(cb.isNotNull(root.get("reraId")), 80, cb)),
                        freshness),
                        // A listing written but not yet read back has no generated score; count it
                        // as zero here rather than letting one null collapse the whole sum.
                        cb.coalesce(root.get("qualityScore").as(Integer.class), 0));
                query.orderBy(
                        cb.desc(cb.selectCase()
                                .when(cb.greaterThan(root.get("boostedUntil"), now), 1)
                                .otherwise(0)),
                        cb.desc(score),
                        cb.desc(root.get("createdAt")),
                        // Same total-order guarantee, same reason: this branch is paged, and two
                        // listings that tie on every term above would otherwise be ordered by
                        // whatever the planner happened to pick for that particular query.
                        cb.desc(root.get("id")));
            }
            return null; // ordering only — no restriction to add
        };
    }

    private static Expression<Integer> weight(Predicate when, int points, CriteriaBuilder cb) {
        return cb.<Integer>selectCase().when(when, points).otherwise(0);
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
            // why: this is the one search whose rows are mapped to the *full* PropertyResponse,
            // which embeds the owner — and Property.owner is LAZY. The derived finders declare
            // @EntityGraph("owner") for that reason, but a specification cannot, so without this
            // the controller maps a detached proxy after the read transaction has closed and every
            // moderation page is a 500. publicSearch deliberately does NOT fetch it: PropertySummary
            // carries no owner contact by construction, so the join would be paid for nothing on
            // the hottest read on the platform.
            //
            // Guarded on the result type for the same reason boostedFirst is: Spring Data issues a
            // separate COUNT query for the page total, and a join fetch there is invalid SQL.
            // owner is a ManyToOne, so the fetch cannot multiply rows and the page size stays exact.
            if (query != null && !Long.class.equals(query.getResultType())) {
                root.fetch("owner", JoinType.LEFT);
            }
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
        // Parsed here rather than at the controller so a value that is not an id at all becomes a
        // predicate matching nothing, instead of a 400 or — as the first draft did, comparing a
        // String against a UUID column — a 500. The profile page is reached by link, so a bad id
        // means a stale or hand-edited URL, and "this person has nothing listed" is the honest
        // answer to it.
        if (StringUtils.hasText(filters.owner())) {
            try {
                where.add(cb.equal(root.get("owner").get("id"), UUID.fromString(filters.owner())));
            } catch (IllegalArgumentException notAnId) {
                where.add(cb.disjunction());
            }
        }
        return where;
    }

    /**
     * The buyer-facing facets from the listings results page (D26). Applied only by
     * {@link #publicSearch}: a moderation queue offers none of these controls, and
     * {@link ListingFacets#NONE} makes every branch here a no-op for it.
     *
     * <p>All of this used to run in the browser over a fully-downloaded catalogue. The move is not a
     * refactor — a predicate the database cannot see cannot participate in {@code ORDER BY} or
     * {@code LIMIT}, so filtering client-side meant every page was a page of the wrong set.
     */
    private static void listingFacets(ListingFacets f, Root<Property> root, CriteriaBuilder cb,
            List<Predicate> where) {
        if (f == null) {
            return;
        }
        // --- unions: any of the selected values matches ---
        inLower(f.types(), root.get("propertyType"), cb, where);
        in(f.furnishings(), root.get("furnishing"), cb, where);
        in(f.localities(), root.get("localitySlug"), cb, where);
        in(f.societies(), root.get("societySlug"), cb, where);
        in(f.landUse(), root.get("landUse"), cb, where);
        in(f.room(), root.get("room"), cb, where);
        in(f.construction(), root.get("possession"), cb, where);
        in(f.availableFromBuckets(), root.get("availableFrom"), cb, where);

        // BHK is a union too, but its top chip is open-ended ("3+"), so a token can be a bound
        // rather than a value. Rendering that as equality is what hid every 4BHK from a buyer who
        // asked for three or more.
        List<String> bhks = clean(f.bhks());
        if (!bhks.isEmpty()) {
            List<Predicate> any = new ArrayList<>();
            for (String token : bhks) {
                boolean open = token.endsWith("plus");
                String digits = open ? token.substring(0, token.length() - 4) : token;
                try {
                    BigDecimal value = new BigDecimal(digits.trim());
                    any.add(open ? cb.ge(root.get("bhk"), value) : cb.equal(root.get("bhk"), value));
                } catch (NumberFormatException notANumber) {
                    // A chip the server does not recognise matches nothing rather than everything:
                    // silently widening a filter looks exactly like the filter working.
                    any.add(cb.disjunction());
                }
            }
            where.add(cb.or(any.toArray(Predicate[]::new)));
        }

        // --- jsonb array facets ---
        // Amenities AND: ticking "lift" and "parking" states two requirements, not two
        // alternatives. Returning a listing with one of them wastes the visit that finds out.
        for (String amenity : clean(f.amenities())) {
            where.add(jsonContains(root.get("amenities"), amenity, cb));
        }
        // PG occupancy ORs: one building genuinely offers several, and a seeker who will take a
        // double or a triple has asked one question, not two.
        anyJson(f.sharing(), root.get("sharing"), cb, where);
        // Tenants ORs *and* admits the silent: an owner who stated no preference has refused
        // nobody, so an empty array must match every tenant filter. Reading silence as refusal
        // would hide most of the inventory from the filter meant to narrow it.
        List<String> tenants = clean(f.tenants());
        if (!tenants.isEmpty()) {
            List<Predicate> any = new ArrayList<>();
            tenants.forEach(t -> any.add(jsonContains(root.get("tenants"), t, cb)));
            any.add(cb.equal(jsonLength(root.get("tenants"), cb), 0));
            where.add(cb.or(any.toArray(Predicate[]::new)));
        }

        // --- trust flags: only ever narrow. `false` means "I did not ask", not "show me the
        // unverified ones" — there is no surface that searches for absent trust. ---
        if (Boolean.TRUE.equals(f.ownerVerified())) {
            where.add(cb.isTrue(root.get("ownerVerified")));
        }
        if (Boolean.TRUE.equals(f.ownershipVerified())) {
            where.add(cb.isTrue(root.get("ownershipVerified")));
        }
        if (Boolean.TRUE.equals(f.societyVerified())) {
            where.add(cb.isTrue(root.get("societyVerified")));
        }
        if (Boolean.TRUE.equals(f.conveyanceDone())) {
            where.add(cb.isTrue(root.get("conveyanceDone")));
        }
        if (Boolean.TRUE.equals(f.pets())) {
            where.add(cb.isTrue(root.get("pets")));
        }
        // The column holds the registration number; the filter only ever asked the yes/no.
        if (Boolean.TRUE.equals(f.rera())) {
            where.add(cb.isNotNull(root.get("reraId")));
        }

        // --- ranges ---
        if (f.minArea() != null) {
            where.add(cb.ge(root.get("area"), f.minArea()));
        }
        if (f.maxArea() != null) {
            where.add(cb.le(root.get("area"), f.maxArea()));
        }
        // An unstated age is excluded from an age search rather than read as zero. `cb.ge` on a
        // null column is already false, so this is what the predicate does anyway — said here so
        // nobody "fixes" it into a coalesce and floats every silent listing to the top of a
        // brand-new-homes search.
        if (f.minAge() != null) {
            where.add(cb.ge(root.get("ageYears"), f.minAge()));
        }
        if (f.maxAge() != null) {
            where.add(cb.le(root.get("ageYears"), f.maxAge()));
        }
        if (f.minFloor() != null) {
            where.add(cb.ge(root.get("floor"), f.minFloor()));
        }
        if (f.maxFloor() != null) {
            where.add(cb.le(root.get("floor"), f.maxFloor()));
        }

        if (f.hasNearPoint()) {
            where.add(withinRadius(root, cb, f.nearLat(), f.nearLng(), f.effectiveRadiusKm()));
        }
    }

    /**
     * "Within N km of this point", without PostGIS — which is not installed, and installing an
     * extension to answer one filter is a deployment dependency bought very cheaply.
     *
     * <p>Two predicates, in this order on purpose. First a latitude/longitude <em>bounding box</em>,
     * computed in Java from the radius: it is a plain range comparison, so the planner can drive it
     * from an index and it throws away almost every row before any trigonometry runs. Then the
     * exact great-circle test on what survives, which trims the box's corners back to a circle.
     * Without the box this is a full-table trigonometric scan on the busiest read on the platform;
     * without the circle, a listing 7km away on the diagonal answers a 5km search.
     *
     * <p>The exact test compares <em>cosines</em> rather than distances: {@code cos} is monotonically
     * decreasing over {@code [0, π]}, so "angle ≤ r" is exactly "cos(angle) ≥ cos(r)". That removes
     * the {@code acos} call entirely, and with it the floating-point domain error that a listing at
     * distance zero would otherwise trigger when rounding pushes the argument a hair above 1.
     *
     * <p>Everything that depends only on the search centre is folded into a constant here rather
     * than recomputed per row.
     */
    private static Predicate withinRadius(Root<Property> root, CriteriaBuilder cb,
            double lat, double lng, double radiusKm) {
        double latRad = Math.toRadians(lat);
        double lngRad = Math.toRadians(lng);
        double cosLat = Math.cos(latRad);
        double sinLat = Math.sin(latRad);

        // Bounding box. One degree of latitude is ~111.045 km everywhere; a degree of longitude
        // shrinks with the cosine of the latitude. The cosine is floored so a search near a pole
        // degenerates into "the whole longitude range" instead of dividing by zero — Pune will
        // never reach that, but a bug that only appears at a latitude nobody tests is not a bug
        // anyone finds.
        double latDelta = radiusKm / 111.045;
        double lngDelta = radiusKm / (111.045 * Math.max(Math.abs(cosLat), 1e-6));
        Predicate box = cb.and(
                cb.between(root.get("lat"), lat - latDelta, lat + latDelta),
                cb.between(root.get("lng"), lng - lngDelta, lng + lngDelta));

        Expression<Double> rowLatRad = radians(root.get("lat"), cb);
        Expression<Double> rowLngRad = radians(root.get("lng"), cb);
        Expression<Double> cosDistance = cb.sum(
                cb.prod(cb.prod(cb.literal(cosLat), fn("cos", rowLatRad, cb)),
                        fn("cos", cb.diff(rowLngRad, cb.literal(lngRad)), cb)),
                cb.prod(cb.literal(sinLat), fn("sin", rowLatRad, cb)));

        double cosRadius = Math.cos(radiusKm / EARTH_RADIUS_KM);
        return cb.and(box, cb.ge(cosDistance, cosRadius));
    }

    private static final double EARTH_RADIUS_KM = 6371.0;

    private static Expression<Double> radians(Expression<?> degrees, CriteriaBuilder cb) {
        return cb.function("radians", Double.class, degrees);
    }

    private static Expression<Double> fn(String name, Expression<?> arg, CriteriaBuilder cb) {
        return cb.function(name, Double.class, arg);
    }

    /**
     * {@code jsonb_exists(column, token)} — the function spelling of Postgres's {@code ?} operator.
     *
     * <p>The function rather than the operator quite deliberately: {@code ?} is also JDBC's bind
     * placeholder, so a driver rewrites it into a parameter and the query fails at a layer well
     * below where anyone is looking. Same semantics, no collision.
     */
    private static Predicate jsonContains(Expression<?> column, String token, CriteriaBuilder cb) {
        return cb.isTrue(cb.function("jsonb_exists", Boolean.class, column, cb.literal(token)));
    }

    private static Expression<Integer> jsonLength(Expression<?> column, CriteriaBuilder cb) {
        return cb.function("jsonb_array_length", Integer.class, column);
    }

    private static void anyJson(List<String> values, Expression<?> column, CriteriaBuilder cb,
            List<Predicate> where) {
        List<String> tokens = clean(values);
        if (tokens.isEmpty()) {
            unmatchableIfAsked(values, cb, where);
            return;
        }
        List<Predicate> any = new ArrayList<>();
        tokens.forEach(t -> any.add(jsonContains(column, t, cb)));
        where.add(cb.or(any.toArray(Predicate[]::new)));
    }

    private static void in(List<String> values, Expression<String> column, CriteriaBuilder cb,
            List<Predicate> where) {
        List<String> tokens = clean(values);
        if (tokens.isEmpty()) {
            unmatchableIfAsked(values, cb, where);
            return;
        }
        where.add(column.in(tokens));
    }

    private static void inLower(List<String> values, Expression<String> column, CriteriaBuilder cb,
            List<Predicate> where) {
        List<String> tokens = clean(values);
        if (tokens.isEmpty()) {
            unmatchableIfAsked(values, cb, where);
            return;
        }
        where.add(cb.lower(column).in(tokens.stream().map(String::toLowerCase).toList()));
    }

    /**
     * Distinguish "this facet was not used" from "it was used, and nothing survived sanitising".
     *
     * <p>Both arrive at the same place — an empty token list — and treating them alike is the more
     * obvious reading, but it fails in the direction that looks like success: a caller who asked
     * for a value that cannot exist gets the entire catalogue back, presented as the answer to
     * their filter. That is strictly worse than an empty page, because an empty page is legible and
     * a full one silently isn't the search that was requested. So a facet the caller did supply
     * contributes a false predicate rather than none.
     */
    private static void unmatchableIfAsked(List<String> values, CriteriaBuilder cb,
            List<Predicate> where) {
        if (values != null && !values.isEmpty()) {
            where.add(cb.disjunction());
        }
    }

    /**
     * Drop blanks and anything outside the shape every one of these vocabularies uses.
     *
     * <p>The pattern is a filter, not validation: a token that cannot be a slug cannot match a row
     * either, so discarding it costs a caller nothing real. It is here because these values reach
     * {@code cb.literal} inside a JSON function, and "Hibernate binds literals as parameters by
     * default" is a defence that depends on a configuration setting staying at its default. A
     * second, local guarantee is worth the four lines.
     */
    private static List<String> clean(List<String> values) {
        if (values == null || values.isEmpty()) {
            return List.of();
        }
        return values.stream()
                .filter(v -> v != null && SAFE_TOKEN.matcher(v).matches())
                .toList();
    }

    private static final Pattern SAFE_TOKEN = Pattern.compile("[A-Za-z0-9 ._+-]{1,64}");
}
