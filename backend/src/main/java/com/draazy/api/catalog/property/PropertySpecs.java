package com.draazy.api.catalog.property;

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
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.hibernate.query.criteria.HibernateCriteriaBuilder;
import org.hibernate.query.criteria.JpaExpression;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

/**
 * Composes the public search predicate, always pinning {@code archived = false AND status = 'approved'};
 * {@link #adminSearch} is a separate method, never a flag. docs/flows/consumer/search-listings.md 9.1.
 */
final class PropertySpecs {

    private PropertySpecs() {
    }

    /** The public-visibility floor plus the requested facets; any null field means "don't filter". */
    static Specification<Property> publicSearch(PropertySearchQuery filters) {
        return publicSearch(filters, ListingFacets.NONE);
    }

    /** The same, plus the buyer-facing facets the results page offers ({@link ListingFacets#NONE} for none). */
    static Specification<Property> publicSearch(PropertySearchQuery filters, ListingFacets extra) {
        return (root, query, cb) -> {
            List<Predicate> where = facets(filters, root, cb);
            publicTextSearch(filters, root, cb, where);
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
     * Ordering-only: floats currently-promoted listings to the top. <strong>Filters nothing</strong>,
     * and applied only when the buyer expressed no order - a boost buys position, never visibility.
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
                        // Total-order tie-break: neither the rank nor created_at is unique and this
                        // branch is paged, so without it a reader can see a row twice.
                        cb.desc(root.get("id")));
            }
            return null; // ordering only — no restriction to add
        };
    }

    /**
     * Default order for the results page: paid placement first, then editorial merit. <strong>Filters
     * nothing</strong>; the score table and the freshness tiers are in search-listings.md 9.3.
     */
    static Specification<Property> relevanceFirst(Instant now) {        return (root, query, cb) -> {
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
                        // Lapsed ownership verification stops earning its 200 points: the facet, the
                        // count and the card badge all read `ownershipLive`, and ranking must agree.
                        weight(ownershipLive(root, cb, now), 200, cb)),
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
                        // Total-order tie-break, as above: this branch is paged and every term can tie.
                        cb.desc(root.get("id")));
            }
            return null; // ordering only — no restriction to add
        };
    }

    private static Expression<Integer> weight(Predicate when, int points, CriteriaBuilder cb) {
        return cb.<Integer>selectCase().when(when, points).otherwise(0);
    }

    /**
     * The moderation search: the same facets with <strong>no visibility floor</strong>, so
     * {@code status} widens rather than narrows. <strong>Staff/admin routes only.</strong>
     */
    static Specification<Property> adminSearch(PropertySearchQuery filters, ModerationFacets mod) {
        return (root, query, cb) -> {
            // Only this search maps rows to the full PropertyResponse, which embeds the LAZY owner;
            // a specification cannot declare @EntityGraph, and the COUNT query must not join-fetch.
            if (query != null && !Long.class.equals(query.getResultType())) {
                root.fetch("owner", JoinType.LEFT);
            }
            List<Predicate> where = facets(filters, root, cb);
            adminTextSearch(filters, root, cb, where);
            if (filters.status() != null) {
                where.add(cb.equal(root.get("status"), filters.status()));
            }
            if (mod.archived() != null) {
                where.add(mod.archived()
                        ? cb.isTrue(root.get("archived")) : cb.isFalse(root.get("archived")));
            }
            if (mod.recheck() != null) {
                where.add(mod.recheck()
                        ? cb.isNotNull(root.get("recheckRequestedAt"))
                        : cb.isNull(root.get("recheckRequestedAt")));
            }
            if (mod.featured() != null) {
                where.add(mod.featured()
                        ? cb.isTrue(root.get("featured")) : cb.isFalse(root.get("featured")));
            }
            if (mod.postedByAdmin() != null) {
                where.add(mod.postedByAdmin()
                        ? cb.isTrue(root.get("postedByAdmin")) : cb.isFalse(root.get("postedByAdmin")));
            }
            if (mod.unconfirmed() != null) {
                // COALESCE to createdAt because posting is itself an assertion of availability; a
                // bare null would drop those rows out of *both* sides of this tri-state.
                Expression<Instant> since =
                        cb.coalesce(root.get("lastConfirmedAt"), root.get("createdAt"));
                Instant cutoff = Freshness.unconfirmedBefore(Instant.now());
                where.add(mod.unconfirmed()
                        ? cb.lessThanOrEqualTo(since, cutoff)
                        : cb.greaterThan(since, cutoff));
            }
            // An unfiltered moderation query is legal and means "everything"; `cb.and()` over an
            // empty array is a vacuous truth in JPA, but conjunction() says so explicitly.
            return where.isEmpty() ? cb.conjunction() : cb.and(where.toArray(Predicate[]::new));
        };
    }

    /**
     * The facets both searches share. Status, {@code q} and the {@link ModerationFacets} axes stay at
     * the call sites because that is exactly where the public and moderation reads must differ.
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
        // Parsed here rather than at the controller so a value that is not an id at all becomes a
        // predicate matching nothing, rather than a 400 or a 500 on a String/UUID comparison.
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
     * The free-text term as a <em>shopper</em> may ask it: title and locality, nothing else. A
     * separate method from {@link #adminTextSearch}, never a flag - search-listings.md 9.2.
     */
    private static void publicTextSearch(PropertySearchQuery filters, Root<Property> root,
            CriteriaBuilder cb, List<Predicate> where) {
        if (!StringUtils.hasText(filters.q())) {
            return;
        }
        String like = "%" + filters.q().trim().toLowerCase() + "%";
        where.add(cb.or(
                cb.like(cb.lower(root.get("title")), like),
                cb.like(cb.lower(root.get("locality")), like)));
    }

    /**
     * The same term as a <em>moderator</em> asks it, adding owner name, owner mobile and the id as
     * text. The id cast must be {@link HibernateCriteriaBuilder#cast}: search-listings.md 9.2.
     */
    private static void adminTextSearch(PropertySearchQuery filters, Root<Property> root,
            CriteriaBuilder cb, List<Predicate> where) {
        if (!StringUtils.hasText(filters.q())) {
            return;
        }
        String term = filters.q().trim().toLowerCase();
        String like = "%" + term + "%";
        // The path is typed to UUID before the cast because HibernateCriteriaBuilder.cast takes a
        // JpaExpression<T>, and an untyped `root.get("id")` is a Path<Object> that matches nothing.
        JpaExpression<UUID> id = (JpaExpression<UUID>) root.<UUID>get("id");
        Expression<String> idAsText = ((HibernateCriteriaBuilder) cb).cast(id, String.class);
        where.add(cb.or(
                cb.like(cb.lower(root.get("title")), like),
                cb.like(cb.lower(root.get("locality")), like),
                cb.like(cb.lower(root.get("owner").get("name")), like),
                cb.like(root.get("owner").get("mobile"), like),
                cb.like(idAsText, like)));
    }

    /**
     * The buyer-facing facets from the listings results page, applied only by {@link #publicSearch}.
     * Filtering here and not client-side: a predicate the database cannot see cannot page correctly.
     */
    private static void listingFacets(ListingFacets f, Root<Property> root, CriteriaBuilder cb,
            List<Predicate> where) {
        if (f == null) {
            return;
        }
        // --- unions: any of the selected values matches ---
        // Canonical key column, not the free-text label; share-aware (only PG/Flatmates admit shares).
        typeFacet(f.types(), root, cb, where);
        // The commercial sub-filter: every commercial label collapses to `commercial` in the type
        // key, so "Warehouse / Godown" needs its own. Only ever narrows within commercial.
        inLowerValues(f.commercialUses(), root.get("commercialUseKey"), cb, where);
        in(f.furnishings(), root.get("furnishing"), cb, where);
        in(f.localities(), root.get("localitySlug"), cb, where);
        in(f.societies(), root.get("societySlug"), cb, where);
        in(f.landUse(), root.get("landUse"), cb, where);
        in(f.room(), root.get("room"), cb, where);
        in(f.construction(), root.get("possession"), cb, where);
        in(f.availableFromBuckets(), root.get("availableFrom"), cb, where);

        // BHK is a union too, but its top chip is open-ended ("3+"), so a token can be a bound
        // rather than a value; equality would hide every 4BHK from a "three or more" search.
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
        // Amenities AND. The empty-after-clean guard matters: an empty loop adds no predicate at all.
        List<String> amenities = clean(f.amenities());
        if (amenities.isEmpty()) {
            unmatchableIfAsked(f.amenities(), cb, where);
        }
        for (String amenity : amenities) {
            where.add(jsonContains(root.get("amenities"), amenity, cb));
        }
        // Tenants OR across selected types. Gendered bachelor searches include the legacy broad
        // `bachelors` declaration, which cannot answer a gender-specific search more precisely.
        List<String> tenantFilters = new ArrayList<>(clean(f.tenants()));
        if (tenantFilters.contains("bachelor-male") || tenantFilters.contains("bachelor-female")) {
            tenantFilters.add("bachelors");
        }
        anyJsonOrNoPreference(tenantFilters.isEmpty() ? f.tenants() : tenantFilters,
            root.get("tenants"), cb, where);

        // --- trust flags: only ever narrow. `false` means "I did not ask", not "show me the
        // unverified ones" — there is no surface that searches for absent trust. ---
        if (Boolean.TRUE.equals(f.ownerVerified())) {
            where.add(cb.isTrue(root.get("ownerVerified")));
        }
        if (Boolean.TRUE.equals(f.ownershipVerified())) {
            where.add(ownershipLive(root, cb, Instant.now()));
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
        // An unstated age is excluded from an age search rather than read as zero. `cb.ge` on a null
        // column is already false; said here so nobody "fixes" it into a coalesce.
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
     * "Within N km of this point", without PostGIS: an indexable bounding box first, then an exact
     * great-circle test on the survivors, compared as cosines. search-listings.md section 9.6.
     */
    private static Predicate withinRadius(Root<Property> root, CriteriaBuilder cb,
            double lat, double lng, double radiusKm) {
        double latRad = Math.toRadians(lat);
        double lngRad = Math.toRadians(lng);
        double cosLat = Math.cos(latRad);
        double sinLat = Math.sin(latRad);

        // One degree of latitude is ~111.045 km; a degree of longitude shrinks with cos(lat), which
        // is floored so a polar search degenerates to the whole range rather than dividing by zero.
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
     * {@code jsonb_exists(column, token)} - the function spelling of Postgres's {@code ?} operator,
     * which JDBC would otherwise rewrite as a bind placeholder.
     */
    private static Predicate jsonContains(Expression<?> column, String token, CriteriaBuilder cb) {
        return cb.isTrue(cb.function("jsonb_exists", Boolean.class, column, cb.literal(token)));
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

    private static void anyJsonOrNoPreference(List<String> values, Expression<?> column,
            CriteriaBuilder cb, List<Predicate> where) {
        List<String> tokens = clean(values);
        if (tokens.isEmpty()) {
            unmatchableIfAsked(values, cb, where);
            return;
        }
        List<Predicate> any = new ArrayList<>();
        tokens.forEach(t -> any.add(jsonContains(column, t, cb)));
        any.add(jsonContains(column, "anyone", cb));
        any.add(cb.isNull(column));
        any.add(cb.equal(cb.function("jsonb_array_length", Integer.class, column), 0));
        where.add(cb.or(any.toArray(Predicate[]::new)));
    }

    /**
     * Ownership verification that has <em>not lapsed</em> as of {@code now}; a null expiry means
     * "does not lapse". The bare column would let the facet and the card badge disagree.
     */
    private static Predicate ownershipLive(Root<Property> root, CriteriaBuilder cb, Instant now) {
        return cb.and(
                cb.isTrue(root.get("ownershipVerified")),
                cb.or(
                        cb.isNull(root.get("ownershipVerifiedUntil")),
                        cb.greaterThan(root.get("ownershipVerifiedUntil"), now)));
    }

    /**
     * "Carries a trust badge a buyer can see", behind the {@code verifiedElements} count - the same
     * disjunction the cards draw their badges from, reusing {@link #ownershipLive}.
     */
    static Specification<Property> anyVerified(Instant now) {
        return (root, query, cb) -> cb.or(cb.isTrue(root.get("ownerVerified")), ownershipLive(root, cb, now));
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

    /**
     * Case-insensitive {@code IN} that lowercases the <em>values</em> and leaves the column bare:
     * {@code lower(property_type_key)} is not the expression {@code idx_properties_type_key} covers.
     */
    private static void inLowerValues(List<String> values, Expression<String> column,
            CriteriaBuilder cb, List<Predicate> where) {
        List<String> tokens = clean(values);
        if (tokens.isEmpty()) {
            unmatchableIfAsked(values, cb, where);
            return;
        }
        where.add(column.in(tokens.stream().map(String::toLowerCase).toList()));
    }

    /** The one type chip that names a share rather than a kind of building. */
    private static final Set<String> SHARE_KEYS = Set.of("flatmates");

    /**
     * The type chips, answered by two columns: {@code flatmates} against {@code share_type},
     * every other chip against {@code property_type_key} plus the absence of a share type. Chips OR.
     */
    private static void typeFacet(List<String> values, Root<Property> root, CriteriaBuilder cb,
            List<Predicate> where) {
        List<String> tokens = clean(values);
        if (tokens.isEmpty()) {
            unmatchableIfAsked(values, cb, where);
            return;
        }
        List<Predicate> anyChip = new ArrayList<>();
        List<String> buildingKeys = new ArrayList<>();
        for (String token : tokens) {
            String key = token.toLowerCase();
            if (SHARE_KEYS.contains(key)) {
                anyChip.add(cb.equal(root.get("shareType"), key));
            } else {
                buildingKeys.add(key);
            }
        }
        if (!buildingKeys.isEmpty()) {
            anyChip.add(cb.and(root.get("shareType").isNull(),
                    root.get("propertyTypeKey").in(buildingKeys)));
        }
        where.add(cb.or(anyChip.toArray(new Predicate[0])));
    }

    /**
     * Distinguish "this facet was not used" from "it was used and nothing survived sanitising": the
     * latter must contribute a false predicate, or an unmatchable filter returns the whole catalogue.
     */
    private static void unmatchableIfAsked(List<String> values, CriteriaBuilder cb,
            List<Predicate> where) {
        if (values != null && !values.isEmpty()) {
            where.add(cb.disjunction());
        }
    }

    /**
     * Drop blanks and anything outside the shape these vocabularies use. A filter, not validation:
     * these values reach {@code cb.literal} inside a JSON function, so the guard is local by design.
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
