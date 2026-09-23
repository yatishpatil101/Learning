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
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.hibernate.query.criteria.HibernateCriteriaBuilder;
import org.hibernate.query.criteria.JpaExpression;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.util.StringUtils;

// Always pins `archived = false AND status = 'approved'`; adminSearch is a separate method, never a flag.
final class PropertySpecs {

    private static final char LIKE_ESCAPE = '\\';
    /** A bound on the free-text term, so a pasted paragraph cannot become a predicate per word. */
    private static final int MAX_Q_TOKENS = 6;

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

    /** Ordering only - <strong>filters nothing</strong>; a boost buys position, never visibility. */
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

    /** Ordering only - <strong>filters nothing</strong>; score table and freshness tiers: search-listings.md 9.3. */
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

    /** <strong>No visibility floor</strong>, so {@code status} widens rather than narrows: staff/admin routes only. */
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

    /** Status, {@code q} and the {@link ModerationFacets} axes stay at the call sites: that is where the two reads must differ. */
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

    /** Matches only what is printed on the card; a separate method from {@link #adminTextSearch}, never a flag. */
    private static void publicTextSearch(PropertySearchQuery filters, Root<Property> root,
            CriteriaBuilder cb, List<Predicate> where) {
        if (!StringUtils.hasText(filters.q())) {
            return;
        }
        Expression<String> title = cb.lower(root.get("title"));
        Expression<String> locality = cb.lower(root.get("locality"));
        // The bound society reaches the row as its slug, so a name matches it word by word or not
        // at all: the slugs are name-builder-locality and nobody types them in that order.
        Expression<String> society = cb.lower(root.get("societySlug"));
        Expression<String> type = cb.lower(root.get("propertyType"));
        /* Every word must appear somewhere rather than the whole phrase in one column: smart search
           sends the words it could not facet, routinely a builder and a project in two columns. */
        Arrays.stream(filters.q().trim().toLowerCase(Locale.ROOT).split("\\s+"))
                .filter(token -> !token.isEmpty())
                .limit(MAX_Q_TOKENS)
                .forEach(token -> {
                    String like = "%" + escapeLike(token) + "%";
                    where.add(cb.or(
                            cb.like(title, like, LIKE_ESCAPE),
                            cb.like(locality, like, LIKE_ESCAPE),
                            cb.like(society, like, LIKE_ESCAPE),
                            cb.like(type, like, LIKE_ESCAPE)));
                });
    }

    /** Unescaped, a search for {@code 100%} returns the whole catalogue while reading as a narrowing. */
    private static String escapeLike(String token) {
        return token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    /** Adds owner name, mobile and the id as text; the id cast must be {@link HibernateCriteriaBuilder#cast}. */
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

    /** Applied only by {@link #publicSearch}: a predicate the database cannot see cannot page correctly. */
    private static void listingFacets(ListingFacets f, Root<Property> root, CriteriaBuilder cb,
            List<Predicate> where) {
        if (f == null) {
            return;
        }
        // Canonical key column, not the free-text label; share-aware (only PG/Flatmates admit shares).
        typeFacet(f.types(), root, cb, where);
        // Every commercial label collapses to `commercial` in the type key, so "Warehouse / Godown"
        // needs its own facet. Only ever narrows within commercial.
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

        // Trust flags only ever narrow: `false` means "I did not ask", not "show me the unverified
        // ones" - there is no surface that searches for absent trust.
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
        // Equality, so a listing that never said who posted it is excluded rather than assumed to
        // be an owner: "no brokerage" is a claim, and silence cannot back it.
        if (Boolean.TRUE.equals(f.postedByOwner())) {
            where.add(cb.equal(root.get("postedByType"), PostedByType.OWNER));
        }

        // A bare bound, which SQL evaluates as false against NULL, would delete every listing silent
        // on these optional columns; they stay in the match and are counted by `unstatedFiltered`.
        if (f.minArea() != null) {
            where.add(cb.or(root.get("area").isNull(), cb.ge(root.get("area"), f.minArea())));
        }
        if (f.maxArea() != null) {
            where.add(cb.or(root.get("area").isNull(), cb.le(root.get("area"), f.maxArea())));
        }
        if (f.minAge() != null) {
            where.add(cb.or(root.get("ageYears").isNull(), cb.ge(root.get("ageYears"), f.minAge())));
        }
        if (f.maxAge() != null) {
            where.add(cb.or(root.get("ageYears").isNull(), cb.le(root.get("ageYears"), f.maxAge())));
        }
        if (f.minFloor() != null) {
            where.add(cb.or(root.get("floor").isNull(), cb.ge(root.get("floor"), f.minFloor())));
        }
        if (f.maxFloor() != null) {
            where.add(cb.or(root.get("floor").isNull(), cb.le(root.get("floor"), f.maxFloor())));
        }
        if (f.minDeposit() != null) {
            where.add(cb.or(root.get("deposit").isNull(), cb.ge(root.get("deposit"), f.minDeposit())));
        }
        if (f.maxDeposit() != null) {
            where.add(cb.or(root.get("deposit").isNull(), cb.le(root.get("deposit"), f.maxDeposit())));
        }

        if (f.hasNearPoint()) {
            where.add(withinRadius(root, cb, f.nearLat(), f.nearLng(), f.effectiveRadiusKm()));
        }
    }

    /** "Within N km" without PostGIS: an indexable bounding box, then an exact great-circle test on the survivors. */
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

    /** The function spelling of Postgres's {@code ?} operator, which JDBC would rewrite as a bind placeholder. */
    private static Predicate jsonContains(Expression<?> column, String token, CriteriaBuilder cb) {
        return cb.isTrue(cb.function("jsonb_exists", Boolean.class, column, cb.literal(token)));
    }

    /** An empty preference is an answer, not silence: an owner who named no tenant type will take
     * anyone, so every tenant search admits them. Contrast {@code pets}, where null means the owner
     * never answered and matching it would advertise a permission nobody gave. */
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

    /** A null expiry means "does not lapse"; the bare column would let the facet and the card badge disagree. */
    private static Predicate ownershipLive(Root<Property> root, CriteriaBuilder cb, Instant now) {
        return cb.and(
                cb.isTrue(root.get("ownershipVerified")),
                cb.or(
                        cb.isNull(root.get("ownershipVerifiedUntil")),
                        cb.greaterThan(root.get("ownershipVerifiedUntil"), now)));
    }

    /** The same disjunction the cards draw their badges from, so the count and the badge cannot disagree. */
    static Specification<Property> anyVerified(Instant now) {
        return (root, query, cb) -> cb.or(cb.isTrue(root.get("ownerVerified")), ownershipLive(root, cb, now));
    }

    /** Rows silent on a filtered column: the bounds admit them, so this count stops that reading as a match. */
    static Specification<Property> unstatedFiltered(ListingFacets f) {
        return (root, query, cb) -> {
            if (f == null) {
                return cb.disjunction();
            }
            List<Predicate> any = new ArrayList<>();
            if (f.minArea() != null || f.maxArea() != null) {
                any.add(root.get("area").isNull());
            }
            if (f.minAge() != null || f.maxAge() != null) {
                any.add(root.get("ageYears").isNull());
            }
            if (f.minFloor() != null || f.maxFloor() != null) {
                any.add(root.get("floor").isNull());
            }
            if (f.minDeposit() != null || f.maxDeposit() != null) {
                any.add(root.get("deposit").isNull());
            }
            return any.isEmpty() ? cb.disjunction() : cb.or(any.toArray(Predicate[]::new));
        };
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

    /** Lowercases the <em>values</em> and leaves the column bare: {@code idx_properties_type_key} does not cover {@code lower(...)}. */
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

    /** Two columns: {@code flatmates} against {@code share_type}, every other chip against {@code property_type_key}. */
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

    // "Used and nothing survived sanitising" must contribute a false predicate, or an unmatchable
    // filter returns the whole catalogue. Emptiness is the test: an absent list param binds empty.
    private static void unmatchableIfAsked(List<String> values, CriteriaBuilder cb,
            List<Predicate> where) {
        if (values != null && !values.isEmpty()) {
            where.add(cb.disjunction());
        }
    }

    /** A local filter, not validation: these values reach {@code cb.literal} inside a JSON function. */
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
