package com.draazy.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/** {@code /admin/analytics/pricing}. Every locality is created by the test, under a slug nothing
 *  else uses, with prices chosen so each wrong implementation reports a different number. */
@DisplayName("/admin/analytics/pricing — what live flats are asked for, from the listings alone")
class AdminPricingAnalyticsTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private String bearerFor(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        // A staff account is keyed in the permission map by its desk, and one with no desk is refused
        // outright. Which desk is immaterial here — the seeded document grants all six the same set.
        if (Roles.Wire.STAFF.equals(role)) u.setTeam(Teams.RENTAL);
        return bearer(users.saveAndFlush(u));
    }

    private String admin() {
        return bearerFor("9877750001", Roles.Wire.ADMIN, "Pricing admin");
    }

    /** A plain authenticated consumer. Signed in, and with no business reading the back office. */
    private String consumer() {
        return bearerFor("9877750002", Roles.Wire.BUYER, "Pricing seeker");
    }

    /** The mobile is drawn from a counter rather than the fixture suffix, which is not always a
     *  digit and produced values the column's check constraint rejected. */
    private final AtomicInteger ownerSeq = new AtomicInteger();

    private User owner(String suffix) {
        User u = new User(String.format("98777%05d", ownerSeq.incrementAndGet()), Roles.Wire.OWNER);
        u.setName("Pricing landlord " + suffix);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void locality(String slug) {
        jdbc.update("insert into localities (slug, name, city, active) values (?, ?, 'Pune', true)",
                slug, "Fixture " + slug);
    }

    /** {@code area} is a {@code BigDecimal} so a test can hand in null or zero, the case the
     *  averages have to survive. Returns the saved row so callers can push it out of scope. */
    private Property listing(String slug, String deal, long price, BigDecimal area, String suffix) {
        return listing(slug, deal, "apartment", price, area, suffix);
    }

    private Property listing(String slug, String deal, String type, long price, BigDecimal area,
                             String suffix) {
        Property p = new Property(owner(suffix), "Fixture " + slug + " " + suffix,
                deal, type, price, "Fixture " + slug, "Pune");
        p.setLocalitySlug(slug);
        p.setArea(area);
        p.setStatus(PropertyStatus.APPROVED);
        p.setPriceUnit("rent".equals(deal) ? "per-month" : "total");
        return properties.saveAndFlush(p);
    }

    /** The report's row for one locality. Isolated by slug — the seeded localities are in here too. */
    private Map<String, Object> row(String token, String slug) throws Exception {
        String json = mvc.perform(get(Routes.Admin.ANALYTICS_PRICING)
                        .header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<Map<String, Object>> matches = JsonPath.read(json, "$[?(@.slug=='" + slug + "')]");
        assertThat(matches).as("exactly one row per active locality").hasSize(1);
        return matches.get(0);
    }

    private static Long num(Map<String, Object> row, String field) {
        Object v = row.get(field);
        return v == null ? null : ((Number) v).longValue();
    }

    @Test
    void anAdminSeesTheCuratedRateBesideTheAskingAverage() throws Exception {
        String slug = "d999-pricing-shape";
        locality(slug);
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "1");
        listing(slug, "buy", 11_000_000L, new BigDecimal("1000"), "1b");
        listing(slug, "buy", 12_000_000L, new BigDecimal("1000"), "2");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "3");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "3b");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "3c");

        Map<String, Object> row = row(admin(), slug);

        assertThat(row.get("name")).isEqualTo("Fixture " + slug);
        assertThat(num(row, "avgActualRatePerSqft")).isEqualTo(11_000L);
        assertThat(num(row, "avgRent")).isEqualTo(30_000L);
        assertThat(((Number) row.get("rentalYieldPct")).doubleValue()).isEqualTo(3.3);
        assertThat(num(row, "buyCount")).isEqualTo(3L);
        assertThat(num(row, "rentCount")).isEqualTo(3L);
        assertThat(num(row, "totalListings")).isEqualTo(6L);
        assertThat(row).doesNotContainKeys("marketRatePerSqft", "demand");
    }

    /** One or two listings are an owner's opinion, not a locality's price, and a verdict of
     *  "overpriced area" off them sends sourcing after noise. */
    @Test
    void fewerThanThreeFlatsIsTooFewToPrice() throws Exception {
        String slug = "d999-pricing-thin";
        locality(slug);
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "t1");
        listing(slug, "buy", 12_000_000L, new BigDecimal("1000"), "t2");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "t3");

        Map<String, Object> row = row(admin(), slug);

        assertThat(row.get("avgActualRatePerSqft")).isNull();
        assertThat(row.get("avgRent")).isNull();
        assertThat(row.get("rentalYieldPct")).isNull();
        assertThat(num(row, "buyCount")).as("still supply").isEqualTo(2L);
    }

    /** The curated rate is a flat rate; a plot or a shop at a tenth of it per sqft is a different
     *  market, not a bargain. */
    @Test
    void onlyFlatsAreAveragedAgainstTheMarketRate() throws Exception {
        String slug = "d999-pricing-mixed";
        locality(slug);
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "m1");
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "m2");
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "m3");
        listing(slug, "buy", "Plot", 1_000_000L, new BigDecimal("1000"), "m4");
        listing(slug, "buy", "Office Space", 30_000_000L, new BigDecimal("1000"), "m5");

        Map<String, Object> row = row(admin(), slug);

        assertThat(num(row, "avgActualRatePerSqft")).isEqualTo(10_000L);
        assertThat(num(row, "buyCount")).as("every type is still supply").isEqualTo(5L);
    }

    /** The only figure combining both halves: a missing ×12 reports 0.3, and dividing
     *  by the monthly rent reports something absurd. */
    @Test
    void rentalYieldAnnualisesTheAskingRentOverTheCapitalRate() throws Exception {
        String slug = "d999-pricing-yield";
        locality(slug);
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "4");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "4b");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "4c");
        listing(slug, "buy", 9_000_000L, new BigDecimal("1000"), "4d");
        listing(slug, "buy", 9_000_000L, new BigDecimal("1000"), "4e");
        listing(slug, "buy", 9_000_000L, new BigDecimal("1000"), "4f");

        Map<String, Object> row = row(admin(), slug);

        assertThat(((Number) row.get("rentalYieldPct")).doubleValue()).isEqualTo(4.0);
    }

    @Test
    void rentalYieldNeedsBothSidesSampled() throws Exception {
        String slug = "d999-pricing-yield-one-sided";
        locality(slug);
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "y1");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "y2");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "y3");

        assertThat(row(admin(), slug).get("rentalYieldPct")).isNull();
    }

    /** A fallback figure gives an empty locality a deviation of exactly zero, which
     *  reads as the best-priced place in the city. */
    @Test
    void aLocalityWithNoApprovedListingsReportsNull() throws Exception {
        String slug = "d999-pricing-empty";
        locality(slug);

        Map<String, Object> row = row(admin(), slug);

        assertThat(row)
                .as("the field is present and null, not omitted — an absent key invites a ?? on the client")
                .containsKey("avgActualRatePerSqft");
        assertThat(row.get("avgActualRatePerSqft"))
                .as("no listings means no average")
                .isNull();
        assertThat(row.get("rentalYieldPct"))
                .as("nothing is let here, so there is no yield to report")
                .isNull();
        assertThat(num(row, "totalListings")).isZero();
        assertThat(num(row, "buyCount")).isZero();
    }

    /** Coalescing a missing area to zero rupees a square foot halves this locality's average —
     *  a 50% drop caused entirely by two owners skipping a form field. */
    @Test
    void aListingWithNoUsableAreaDoesNotCorruptTheAverage() throws Exception {
        String slug = "d999-pricing-noarea";
        locality(slug);
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "5");
        listing(slug, "buy", 11_000_000L, new BigDecimal("1000"), "5b");
        listing(slug, "buy", 12_000_000L, new BigDecimal("1000"), "6");
        listing(slug, "buy", 8_000_000L, null, "7");
        listing(slug, "buy", 8_000_000L, BigDecimal.ZERO, "8");

        Map<String, Object> row = row(admin(), slug);

        assertThat(num(row, "avgActualRatePerSqft"))
                .as("averaged over the three listings that carry an area, and only those")
                .isEqualTo(11_000L);
        assertThat(num(row, "buyCount"))
                .as("all five are still listings — supply and the sample are different questions")
                .isEqualTo(5L);
        assertThat(num(row, "totalListings")).isEqualTo(5L);
    }

    /** Locality-by-locality pricing is commercially sensitive; a signed-in seeker is still public. */
    @Test
    void aPlainConsumerIsRefused() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS_PRICING)
                        .header(HttpHeaders.AUTHORIZATION, consumer()))
                .andExpect(status().isForbidden());
    }

    /** The acceptance half: refusing everyone would pass the test above while leaving the report
     *  unreachable by the team that sources on it. */
    @Test
    void opsStaffReachesIt() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS_PRICING)
                        .header(HttpHeaders.AUTHORIZATION,
                                bearerFor("9877750003", Roles.Wire.STAFF, "Pricing ops")))
                .andExpect(status().isOk());
    }

    /** No token at all is a different rejection from the wrong one, and worth pinning separately. */
    @Test
    void anAnonymousCallerIsRefused() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS_PRICING))
                .andExpect(status().isUnauthorized());
    }

    /** The only test that builds a non-approved or archived row: drop either clause and everything
     *  else here still passes while the report prices localities off listings nobody can buy. */
    @Test
    void aPendingOrArchivedListingIsNeitherCountedNorAveraged() throws Exception {
        String slug = "d999-pricing-invisible";
        locality(slug);
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "9");
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "9b");
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "9c");

        Property pending = listing(slug, "buy", 30_000_000L, new BigDecimal("1000"), "a");
        pending.setStatus(PropertyStatus.PENDING);
        properties.saveAndFlush(pending);

        Property archived = listing(slug, "buy", 40_000_000L, new BigDecimal("1000"), "b");
        jdbc.update("update properties set archived = true where id = ?", archived.getId());

        Map<String, Object> row = row(admin(), slug);

        assertThat(num(row, "avgActualRatePerSqft"))
                .as("the approved listings; ₹30,000 or ₹40,000 per sqft would be unmissable in the mean")
                .isEqualTo(10_000L);
        assertThat(num(row, "buyCount"))
                .as("a listing awaiting review is not supply, and an archived one is gone")
                .isEqualTo(3L);
        assertThat(num(row, "totalListings")).isEqualTo(3L);
    }

    /** A non-live locality is reported only while approved listings are still bound to it. */
    @Test
    void aRetiredLocalityIsReportedOnlyWhileItHasLiveListings() throws Exception {
        String slug = "d999-pricing-retired";
        locality(slug);
        jdbc.update("update localities set archived_at = now() where slug = ?", slug);
        String busy = "d999-pricing-retired-live";
        locality(busy);
        jdbc.update("update localities set archived_at = now() where slug = ?", busy);
        listing(busy, "buy", 10_000_000L, new BigDecimal("1000"), "r1");

        String json = mvc.perform(get(Routes.Admin.ANALYTICS_PRICING)
                        .header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(JsonPath.read(json, "$[?(@.slug=='" + slug + "')]").toString())
                .isEqualTo("[]");
        assertThat(JsonPath.<List<Object>>read(json, "$[?(@.slug=='" + busy + "')]")).hasSize(1);
    }
}
