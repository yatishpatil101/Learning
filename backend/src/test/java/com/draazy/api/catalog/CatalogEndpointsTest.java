package com.draazy.api.catalog;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** Nothing here is owner-scoped, so the exposures are enumeration and unbounded anonymous reads.
 *  Count-bearing assertions read live counts rather than hard-coding a regenerable seed size. */
class CatalogEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @PersistenceContext
    EntityManager em;

    /** Forces a real SELECT: the test shares a transaction with the handler, and
     *  {@code Property.societySlug} is a {@code @Formula} only ever populated by a query. */
    private void detach() {
        em.flush();
        em.clear();
    }

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

    /** An array, because the table is keyed by deal and one object cannot say which. */
    @Test
    void feesReturnsOneEntryPerDealIntent() throws Exception {
        mvc.perform(get("/fees"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].deal").value("buy"))
                .andExpect(jsonPath("$[0].brokerage").value(0))
                .andExpect(jsonPath("$[1].deal").value("rent"))
                .andExpect(jsonPath("$[1].platformFee").value(500));
    }

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

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "waitlistIsIdempotentPerMobileAndCity       | 9830000002 | Nagpur | Nagpur | 1",
            "waitlistAllowsTheSamePersonToAskForTwoCities | 9830000003 | Nashik | Nagpur | 2",
            "waitlistTreatsCityCaseInsensitively        | 9830000004 | Mumbai | mumbai | 1"})
    void waitlistDedupesPerMobileAndCity(String name, String mobile, String first, String second,
            int rows) throws Exception {
        for (String city : new String[] {first, second}) {
            mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"mobile\":\"" + mobile + "\",\"city\":\"" + city + "\"}"))
                    .andExpect(status().isCreated());
        }

        assertThat(jdbc.queryForObject(
                "select count(*) from city_waitlist where mobile = ?", Integer.class, mobile))
                .isEqualTo(rows);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "waitlistRejectsAMalformedMobile | {\"mobile\":\"12345\",\"city\":\"Nashik\"}",
            "waitlistRequiresACity           | {\"mobile\":\"9830000005\",\"city\":\"  \"}"})
    void waitlistRejectsAnInvalidSignup(String name, String body) throws Exception {
        mvc.perform(post("/cities/waitlist").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void localitiesListIsAlphabeticalAndCarriesComputedCounts() throws Exception {
        User o = owner("9840000001");
        listing(o, "In Aundh", "aundh", null, "approved");
        listing(o, "Archived in Aundh", "aundh", null, "approved").archive("test");
        properties.flush();

        // Data-driven so a catalogue regeneration cannot red this: the seed's size and its
        // alphabetically-first row are read from the same rows the endpoint serves.
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

    /** The stored column is poisoned with an impossible 999, so a pass cannot be coincidence:
     *  trusting the column gives 999, dropping the live predicate gives 2, computing it gives 1. */
    /** Every seeded row has {@code '[]'} there, so without writing a real value "the mapping works"
     *  would only fail the day somebody authors content. */
    @Test
    void aRetiredLocalityDropsOffTheList() throws Exception {

    /** A retired locality is gone from the site, not merely delisted — otherwise search keeps it. */
        int activeBefore = jdbc.queryForObject(
                "select count(*) from localities where active", Integer.class);
        String slug = jdbc.queryForObject(
                "select slug from localities where active order by slug asc limit 1", String.class);
        jdbc.update("update localities set active = false where slug = ?", slug);

        mvc.perform(get("/localities"))
                .andExpect(jsonPath("$.length()").value(activeBefore - 1));
    }

    @Test
    void societiesBrowseIsPagedAndAlphabeticalByDefault() throws Exception {

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

    /** Spring's own ceiling is 2000, which on a tokenless endpoint is free amplification; the
     *  contract publishes 100. */
    @Test
    void societiesBrowseClampsAHostilePageSize() throws Exception {
        mvc.perform(get("/societies?size=5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

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

    /** The slug, not {@code society_id}: every society route takes a slug. Asserted on the summary
     *  too, since a field appearing only after the click cannot drive a filter or a count. */
    @Test
    void aBoundListingCarriesItsSocietySlugOnTheCardAndOnDetail() throws Exception {
        User o = owner("9850000021");
        Property p = listing(o, "Bound to Amanora", "hadapsar",
                societyId("amanora-park-hadapsar"), "approved");
        detach();

        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.societySlug").value("amanora-park-hadapsar"));

        mvc.perform(get("/properties").param("q", "Bound to Amanora"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].societySlug").value("amanora-park-hadapsar"));
    }

    @Test
    void anUnboundListingClaimsNoSociety() throws Exception {
        User o = owner("9850000022");
        Property p = listing(o, "Bound to nothing", "hadapsar", null, "approved");
        detach();

        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.societySlug").doesNotExist());
    }

    // The query is deliberately out of slug order and shares no word with the title.
    @Test
    void publicSearchMatchesASocietyNameWordByWordAndAndsTheWords() throws Exception {
        User o = owner("9850000031");
        listing(o, "Corner unit", "hadapsar", societyId("amanora-park-hadapsar"), "approved");
        listing(o, "Elsewhere unit", "kothrud", null, "approved");
        detach();

        mvc.perform(get("/properties").param("q", "park amanora"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Corner unit"));

        mvc.perform(get("/properties").param("q", "amanora elsewhere"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void publicSearchTreatsALikeWildcardAsText() throws Exception {
        User o = owner("9850000032");
        listing(o, "Wildcard 100% cotton awning", "baner", null, "approved");
        listing(o, "Ordinary unit", "baner", null, "approved");
        detach();

        mvc.perform(get("/properties").param("q", "%"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Wildcard 100% cotton awning"));
    }

    @Test
    void publicSearchRefusesATermLongerThanTheContractDeclares() throws Exception {
        mvc.perform(get("/properties").param("q", "a".repeat(121)))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(get("/properties").param("q", "a".repeat(120)))
                .andExpect(status().isOk());
    }

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
    /** The contract offers no sort here, but Spring binds one anyway and would hand an unknown
     *  property to Spring Data — a 500 any anonymous caller could trigger by guessing. */
    }
}
