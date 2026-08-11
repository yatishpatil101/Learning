package com.punenest.api.catalog;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behavior proof for the public reference catalogue: cities, localities, societies, reels
 * and fees.
 *
 * <p><strong>What this slice is at risk of is different from every slice before it.</strong> Nothing
 * here is owner-scoped, so there is no cross-tenant leak to test for. The exposures are instead
 * enumeration, unbounded reads and per-row queries on endpoints anyone can call without a token —
 * so the load-bearing assertions below are the page-size cap, the sort whitelist, the computed
 * counters, and the fact that every route answers without authentication.
 *
 * <p>Runs against the live Flyway'd Postgres, so the seeded reference rows
 * ({@code R__seed_reference_data.sql} — generated from the frontend catalogue, so its size grows the
 * next time the catalogue is regenerated) are real data, not fixtures. Test-local rows are added on
 * top and rolled back. The count- and order-bearing assertions read the live counts from the DB
 * rather than hard-coding a seed size, so they don't re-rot when the catalogue regenerates (D145).
 */
class CatalogEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** A listing in a known locality/society, at a chosen moderation status. */
    private Property listing(User owner, String title, String localitySlug, UUID societyId,
            String status) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setLocalitySlug(localitySlug);
        p.setSocietyId(societyId);
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    private UUID societyId(String slug) {
        return jdbc.queryForObject("select id from societies where slug = ?", UUID.class, slug);
    }

    // ---------------- public reachability (the whole tag is `security: []`) ----------------

    /**
     * Every catalogue route answers with no Authorization header.
     *
     * <p>This is the route-constant/security-matcher agreement check for the slice: a route mapped in
     * a controller but missed in {@code SecurityConfig} would 401 here, which is precisely the bug a
     * per-endpoint test would not catch because each endpoint's own test could be written with a
     * token.
     */
    @Test
    void everyCatalogueRouteIsReachableWithoutAToken() throws Exception {
        mvc.perform(get("/fees")).andExpect(status().isOk());
        mvc.perform(get("/cities")).andExpect(status().isOk());
        mvc.perform(get("/localities")).andExpect(status().isOk());
        mvc.perform(get("/localities/kothrud")).andExpect(status().isOk());
        mvc.perform(get("/societies")).andExpect(status().isOk());
        mvc.perform(get("/societies/amanora-park-hadapsar")).andExpect(status().isOk());
        mvc.perform(get("/reels")).andExpect(status().isOk());
    }

    // ---------------- GET /fees ----------------

    /** Spec fix S24: an array, because the table is keyed by deal and one object cannot say which. */
    @Test
    void feesReturnsOneEntryPerDealIntent() throws Exception {
        mvc.perform(get("/fees"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].deal").value("buy"))
                .andExpect(jsonPath("$[0].brokerage").value(0))
                .andExpect(jsonPath("$[1].deal").value("rent"))
                .andExpect(jsonPath("$[1].platformFee").value(1999));
    }

    /**
     * Neither deal publishes a flat stamp duty, because neither has one.
     *
     * <p>The {@code buy} row was seeded {@code 0} and V52 left it there on purpose, naming it as a
     * separate untruth. Zero is not "unknown": on a public page beside a zero-brokerage promise it
     * reads as the state waiving the single largest cost of buying a home. Maharashtra charges 5-7%
     * of the higher of agreement value and ready reckoner rate — several lakh rupees on a typical
     * flat — and no figure in this table can be right, because the table has never seen the value it
     * is a percentage of.
     *
     * <p>So the assertion is {@code doesNotExist}, not {@code value(0)}. Registration stays present
     * for {@code buy}: 1% capped at ₹30,000 is a genuinely published cap, and a figure that exists
     * should be sent. The distinction being pinned is exactly that — absent means uncomputable, not
     * free — and it is what stops a client summing a false zero into a quote.
     */
    @Test
    void neitherDealPublishesAFlatStampDuty() throws Exception {
        mvc.perform(get("/fees"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].deal").value("buy"))
                .andExpect(jsonPath("$[0].stampDuty").doesNotExist())
                .andExpect(jsonPath("$[0].registration").value(30000))
                .andExpect(jsonPath("$[1].deal").value("rent"))
                .andExpect(jsonPath("$[1].stampDuty").doesNotExist());
    }

    // ---------------- GET /cities ----------------

    /**
     * The city's listing count is computed, not read from {@code cities.listing_count}.
     *
     * <p>This is the D7.2 regression test, and it is deliberately built so that the stored column and
     * the truth disagree: the seeded column says 0, three properties exist, and only two of them are
     * approved and unarchived. A count of 0 means somebody started trusting the column again; a count
     * of 3 means the "live" predicate was dropped.
     */
    @Test
    void cityListingCountIsComputedFromLiveListings_notTheStoredColumn() throws Exception {
        User o = owner("9820000001");
        listing(o, "Live one", "kothrud", null, "approved");
        listing(o, "Live two", "baner", null, "approved");
        listing(o, "Still pending", "baner", null, "pending");

        assertThat(jdbc.queryForObject(
                "select listing_count from cities where slug = 'pune'", Integer.class))
                .as("the stored counter is still stale — that is the point of this test")
                .isZero();

        mvc.perform(get("/cities"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].slug").value("pune"))
                .andExpect(jsonPath("$[0].live").value(true))
                .andExpect(jsonPath("$[0].listingCount").value(2));
    }

    // ---------------- POST /cities/waitlist ----------------

    @Test
    void waitlistAcceptsASignup() throws Exception {
        mvc.perform(post("/cities/waitlist")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mobile":"9830000001","city":"Nashik","email":"a@example.com"}"""))
                .andExpect(status().isCreated());

        assertThat(jdbc.queryForObject(
                "select count(*) from city_waitlist where mobile = ? and city = ?",
                Integer.class, "9830000001", "Nashik")).isEqualTo(1);
    }

    /**
     * Asking twice is the same as asking once — 201 both times, one row.
     *
     * <p>Enforced by {@code uq_city_waitlist_mobile_city}, not by a service-side existence check: two
     * concurrent submissions would both pass a check and both insert. A 409 on the second call would
     * also turn a signup form into a membership oracle on a public endpoint.
     */
    @Test
    void waitlistIsIdempotentPerMobileAndCity() throws Exception {
        String body = """
                {"mobile":"9830000002","city":"Nagpur"}""";
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());

        assertThat(jdbc.queryForObject(
                "select count(*) from city_waitlist where mobile = ?", Integer.class, "9830000002"))
                .isEqualTo(1);
    }

    /** Same person, different city, is a different request — the constraint is on the pair. */
    @Test
    void waitlistAllowsTheSamePersonToAskForTwoCities() throws Exception {
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mobile":"9830000003","city":"Nashik"}"""))
                .andExpect(status().isCreated());
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mobile":"9830000003","city":"Nagpur"}"""))
                .andExpect(status().isCreated());

        assertThat(jdbc.queryForObject(
                "select count(*) from city_waitlist where mobile = ?", Integer.class, "9830000003"))
                .isEqualTo(2);
    }

    /** City case is not identity: the unique index lower-cases free text a person typed. */
    @Test
    void waitlistTreatsCityCaseInsensitively() throws Exception {
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mobile":"9830000004","city":"Mumbai"}"""))
                .andExpect(status().isCreated());
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mobile":"9830000004","city":"mumbai"}"""))
                .andExpect(status().isCreated());

        assertThat(jdbc.queryForObject(
                "select count(*) from city_waitlist where mobile = ?", Integer.class, "9830000004"))
                .isEqualTo(1);
    }

    @Test
    void waitlistRejectsAMalformedMobile() throws Exception {
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mobile":"12345","city":"Nashik"}"""))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void waitlistRequiresACity() throws Exception {
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mobile":"9830000005","city":"  "}"""))
                .andExpect(status().isUnprocessableEntity());
    }

    // ---------------- GET /localities ----------------

    @Test
    void localitiesListIsAlphabeticalAndCarriesComputedCounts() throws Exception {
        User o = owner("9840000001");
        listing(o, "In Aundh", "aundh", null, "approved");
        listing(o, "Archived in Aundh", "aundh", null, "approved").archive("test");
        properties.flush();

        // Data-driven so the assertion survives the next catalogue regeneration (D145): the seed is
        // generated from the frontend, so its size and its alphabetically-first row are not constants
        // to be re-typed here — they are read from the same rows the endpoint serves. The computed
        // count is proven by pinning it to the one locality we seeded a listing into.
        int activeLocalities = jdbc.queryForObject(
                "select count(*) from localities where active", Integer.class);
        String firstByName = jdbc.queryForObject(
                "select name from localities where active order by name asc limit 1", String.class);

        mvc.perform(get("/localities"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(activeLocalities))
                .andExpect(jsonPath("$[0].name").value(firstByName))
                .andExpect(jsonPath("$[0].city").value("Pune"))
                .andExpect(jsonPath("$[?(@.slug=='aundh')].listingCount", contains(1)));
    }

    // ---------------- GET /localities/{slug} ----------------

    @Test
    void localityDetailCarriesTheNarrativeFields() throws Exception {
        mvc.perform(get("/localities/koregaon-park"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("koregaon-park"))
                .andExpect(jsonPath("$.name").value("Koregaon Park"))
                .andExpect(jsonPath("$.connectivity").isArray())
                .andExpect(jsonPath("$.highlights").isArray())
                .andExpect(jsonPath("$.priceTrends").isArray());
    }

    /**
     * The detail path computes its count too — the D7.2 guard for {@code forLocalitySlug}.
     *
     * <p>The city test above covers the grouped accessor over a column seeded to 0. This one covers
     * the single-key accessor and poisons the stored column with a value that is both non-zero and
     * impossible, so a pass cannot be a coincidence: reading {@code localities.listing_count} yields
     * 999, dropping the "approved and unarchived" predicate yields 2, and only computing it correctly
     * yields 1.
     */
    @Test
    void localityDetailListingCountIsComputed_notTheStoredColumn() throws Exception {
        User o = owner("9820000077");
        listing(o, "Live in Kothrud", "kothrud", null, "approved");
        listing(o, "Pending in Kothrud", "kothrud", null, "pending");
        jdbc.update("update localities set listing_count = 999 where slug = 'kothrud'");

        mvc.perform(get("/localities/kothrud"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("kothrud"))
                .andExpect(jsonPath("$.listingCount").value(1));
    }

    /**
     * The {@code price_trends} jsonb actually round-trips into the contract's element shape.
     *
     * <p>Worth its own test because every seeded row has {@code '[]'} there: without writing a real
     * value, "the mapping works" would be an untested claim that only fails the day somebody authors
     * content.
     */
    @Test
    void localityPriceTrendsDeserializeFromJsonb() throws Exception {
        jdbc.update("""
                update localities set price_trends = ?::jsonb where slug = 'baner'""",
                """
                [{"month":"2026-05","rentPsf":32.5,"buyPsf":11500},
                 {"month":"2026-06","rentPsf":33.0,"buyPsf":11800}]""");

        mvc.perform(get("/localities/baner"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.priceTrends.length()").value(2))
                .andExpect(jsonPath("$.priceTrends[0].month").value("2026-05"))
                .andExpect(jsonPath("$.priceTrends[0].rentPsf").value(32.5))
                .andExpect(jsonPath("$.priceTrends[1].buyPsf").value(11800));
    }

    @Test
    void localityDetailIs404ForAnUnknownSlug() throws Exception {
        mvc.perform(get("/localities/not-a-place"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not_found"));
    }

    /** A retired locality is gone from the site, not merely delisted — otherwise search keeps it. */
    @Test
    void localityDetailIs404ForARetiredLocality() throws Exception {
        // Pick the slug to retire from the DB rather than naming one (D145): a hard-coded slug that a
        // future catalogue regeneration ships inactive (or drops) would turn the UPDATE into a silent
        // no-op, the count would not move, and this would red again — the exact drift D145 removes.
        int activeBefore = jdbc.queryForObject(
                "select count(*) from localities where active", Integer.class);
        String slug = jdbc.queryForObject(
                "select slug from localities where active order by slug asc limit 1", String.class);
        jdbc.update("update localities set active = false where slug = ?", slug);

        mvc.perform(get("/localities/" + slug)).andExpect(status().isNotFound());
        mvc.perform(get("/localities"))
                .andExpect(jsonPath("$.length()").value(activeBefore - 1));
    }

    // ---------------- GET /societies ----------------

    @Test
    void societiesBrowseIsPagedAndAlphabeticalByDefault() throws Exception {
        // Data-driven for the same reason as the localities list (D145): the total and the first row
        // are read from the seed, not re-typed, so a catalogue regeneration can't red the suite. The
        // paging envelope and the presence of the trust fields (source/claimStatus) are the invariants
        // this test actually owns.
        int totalSocieties = jdbc.queryForObject(
                "select count(*) from societies", Integer.class);
        String firstByName = jdbc.queryForObject(
                "select name from societies order by name asc limit 1", String.class);

        mvc.perform(get("/societies"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(totalSocieties))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.sort").value("name,asc"))
                .andExpect(jsonPath("$.content[0].name").value(firstByName))
                .andExpect(jsonPath("$.content[0].source").isString())
                .andExpect(jsonPath("$.content[0].claimStatus").isString());
    }

    /** S25: {@code security} is free text. A boolean could not have carried this. */
    @Test
    void societySecurityIsDescriptiveText() throws Exception {
        mvc.perform(get("/societies?q=Amanora"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].security").value("3-tier + CCTV"));
    }

    @Test
    void societiesBrowseFiltersByFreeTextAcrossNameAndBuilder() throws Exception {
        mvc.perform(get("/societies?q=godrej"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$.content[0].builder")
                        .value(org.hamcrest.Matchers.containsStringIgnoringCase("godrej")));
    }

    @Test
    void societiesBrowseFiltersByLocalitySlug() throws Exception {
        mvc.perform(get("/societies?locality=kharadi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].localitySlug").value("kharadi"));
    }

    /**
     * An unknown sort field is dropped rather than passed to the database.
     *
     * <p>{@code claim_status} is a real column, which is what makes it the right probe: the test
     * fails if the whitelist is removed, not merely if the column name is wrong.
     */
    @Test
    void societiesBrowseIgnoresASortFieldOutsideTheWhitelist() throws Exception {
        mvc.perform(get("/societies?sort=claimStatus,desc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sort").value("name,asc"));
    }

    @Test
    void societiesBrowseHonoursAWhitelistedSort() throws Exception {
        mvc.perform(get("/societies?sort=occupancy,desc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sort").value("occupancy,desc"));
    }

    /**
     * A hostile page size is clamped to the contract's maximum.
     *
     * <p>Spring's own default ceiling is 2000. On an endpoint that needs no token, that is a free
     * amplification: one request, two thousand rows. The contract published 100; the server now
     * enforces it.
     */
    @Test
    void societiesBrowseClampsAHostilePageSize() throws Exception {
        mvc.perform(get("/societies?size=5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    // ---------------- GET /societies/{slug} ----------------

    @Test
    void societyDetailListsItsLiveHomesOnly() throws Exception {
        User o = owner("9850000001");
        UUID amanora = societyId("amanora-park-hadapsar");
        listing(o, "Live in Amanora", "hadapsar", amanora, "approved");
        listing(o, "Pending in Amanora", "hadapsar", amanora, "pending");

        mvc.perform(get("/societies/amanora-park-hadapsar"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("amanora-park-hadapsar"))
                .andExpect(jsonPath("$.listingCount").value(1))
                .andExpect(jsonPath("$.homes.length()").value(1))
                .andExpect(jsonPath("$.homes[0].title").value("Live in Amanora"))
                .andExpect(jsonPath("$.homes[0].status").value("approved"));
    }

    /**
     * Reviews are honestly absent rather than dishonestly zero.
     *
     * <p>{@code reviews.target_id} is untyped text and nothing has decided whether a society review
     * keys on the id or the slug, so an aggregate here would be a guess presented as a fact.
     * {@code avgRating} is null, not {@code 0.0}: no rating is not a rating of zero.
     */
    @Test
    void societyDetailReportsNoReviewsRatherThanAZeroRating() throws Exception {
        mvc.perform(get("/societies/amanora-park-hadapsar"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reviews").isEmpty())
                .andExpect(jsonPath("$.reviewCount").value(0))
                .andExpect(jsonPath("$.avgRating").doesNotExist());
    }

    @Test
    void societyDetailIs404ForAnUnknownSlug() throws Exception {
        mvc.perform(get("/societies/no-such-society"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not_found"));
    }

    /**
     * {@code followedByMe} is false for an anonymous reader and true for the follower — on the same
     * public route.
     *
     * <p>This is decision D7.4 in one test: {@code permitAll} does not reject a valid token, so the
     * principal is populated when one is present and null when it is not. If the route had been
     * secured to make this field possible, the anonymous call would 401 instead of answering false.
     */
    @Test
    void followedByMeReflectsTheCallerAndDefaultsToFalseWhenAnonymous() throws Exception {
        User follower = owner("9850000002");
        UUID amanora = societyId("amanora-park-hadapsar");
        jdbc.update("insert into society_follows (user_id, society_id) values (?, ?)",
                follower.getId(), amanora);

        mvc.perform(get("/societies/amanora-park-hadapsar"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.followedByMe").value(false))
                .andExpect(jsonPath("$.followerCount").value(1));

        mvc.perform(get("/societies/amanora-park-hadapsar")
                        .header(HttpHeaders.AUTHORIZATION, bearer(follower)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.followedByMe").value(true))
                .andExpect(jsonPath("$.followerCount").value(1));
    }

    /** The same, on the list surface — where getting it wrong would mean a query per row. */
    @Test
    void followedByMeIsResolvedForAWholePageOfSocieties() throws Exception {
        User follower = owner("9850000003");
        jdbc.update("insert into society_follows (user_id, society_id) values (?, ?)",
                follower.getId(), societyId("aditya-shagun-kothrud"));

        mvc.perform(get("/societies?sort=name,asc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(follower)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].slug").value("aditya-shagun-kothrud"))
                .andExpect(jsonPath("$.content[0].followedByMe").value(true))
                .andExpect(jsonPath("$.content[0].followerCount").value(1))
                .andExpect(jsonPath("$.content[1].followedByMe").value(false));
    }

    // ---------------- GET /reels ----------------

    @Test
    void reelsFeedIsNewestFirstAndCarriesTheContractShape() throws Exception {
        mvc.perform(get("/reels"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(10))
                .andExpect(jsonPath("$[0].id").exists())
                .andExpect(jsonPath("$[0].title").exists())
                .andExpect(jsonPath("$[0].deal").value(org.hamcrest.Matchers.oneOf("buy", "rent")));
    }

    @Test
    void reelsFeedFiltersByLocalityCaseInsensitively() throws Exception {
        mvc.perform(get("/reels?locality=hinjawadi"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()")
                        .value(org.hamcrest.Matchers.greaterThan(0)))
                .andExpect(jsonPath("$[0].locality")
                        .value(org.hamcrest.Matchers.equalToIgnoringCase("hinjawadi")));
    }

    @Test
    void reelsFeedClampsAHostilePageSize() throws Exception {
        mvc.perform(get("/reels?size=5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()")
                        .value(org.hamcrest.Matchers.lessThanOrEqualTo(100)));
    }

    /**
     * An unrequested {@code ?sort=} cannot reach the query.
     *
     * <p>The contract offers no sort on this feed, but Spring binds one from the query string
     * regardless and would hand an unknown property straight to Spring Data — a 500 that any
     * anonymous caller could trigger by guessing. The feed's own order stands instead.
     */
    @Test
    void reelsFeedIgnoresAnUnrequestedSortParameter() throws Exception {
        mvc.perform(get("/reels?sort=dropTable,desc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(10));
    }
}
