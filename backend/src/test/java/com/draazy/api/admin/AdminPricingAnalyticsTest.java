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
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * {@code /admin/analytics/pricing} — the read that replaced a browser-side comparison.
 *
 * <p><strong>Every locality here is created by the test.</strong> The reference seed carries real
 * Pune localities with curated rates and, in a freshly migrated database, no approved listings
 * behind them. Asserting against those would produce a class that passes whether the aggregate is
 * right or wrong, because every figure it could check is null either way — and it would start
 * failing the day somebody seeds a listing in Baner for an unrelated reason. Each test inserts the
 * locality whose shape it is asserting, under a slug nothing else uses, and {@code @Transactional}
 * rolls it back.
 *
 * <p><strong>The fixture prices are chosen so that the wrong implementations disagree.</strong> Two
 * buy listings at ₹10,000 and ₹12,000 a square foot average to ₹11,000 against a curated market rate
 * of ₹9,000. Every number is distinct: an implementation that returned the market rate reports
 * 9,000, one that averaged in a zero-area listing as zero reports 5,500, one that summed rupees and
 * divided by summed area rather than averaging the rates would separate too if the areas differed.
 * A locality whose curated rate happened to equal its listings' average would have made all of those
 * pass.
 */
@DisplayName("/admin/analytics/pricing — asking price against the curated rate")
class AdminPricingAnalyticsTest extends AbstractApiTest {

    /** The curated capital rate on every fixture locality. Unlike any average the tests expect. */
    private static final long MARKET_RATE = 9_000L;

    /** The curated monthly rent reference. Carried through untouched, so it is asserted as-is. */
    private static final long AVG_RENT = 27_000L;

    private static final int DEMAND = 71;

    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;

    private String bearerFor(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    private String admin() {
        return bearerFor("9877750001", Roles.Wire.ADMIN, "Pricing admin");
    }

    /** A plain authenticated consumer. Signed in, and with no business reading the back office. */
    private String consumer() {
        return bearerFor("9877750002", Roles.Wire.BUYER, "Pricing seeker");
    }

    /**
     * A distinct owner per listing. The mobile is drawn from a counter rather than built out of the
     * caller's suffix: the suffix also names the fixture, so the moment one was not a digit it
     * produced a mobile the column's check constraint rejected.
     */
    private final AtomicInteger ownerSeq = new AtomicInteger();

    private User owner(String suffix) {
        User u = new User(String.format("98777%05d", ownerSeq.incrementAndGet()), Roles.Wire.OWNER);
        u.setName("Pricing landlord " + suffix);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** An active locality with a full set of curated figures, so nothing is null by accident. */
    private void locality(String slug) {
        jdbc.update("""
                insert into localities (slug, name, city, rate_per_sqft, avg_rent, demand, active)
                values (?, ?, 'Pune', ?, ?, ?, true)
                """, slug, "Fixture " + slug, MARKET_RATE, AVG_RENT, DEMAND);
    }

    /**
     * An approved listing. {@code area} is passed as a {@code BigDecimal} so a test can hand in null
     * or zero, which is the case the averages have to survive. Returns the saved row so a caller can
     * push it out of the report's scope afterwards — the visibility filters need rows to exclude.
     */
    private Property listing(String slug, String deal, long price, BigDecimal area, String suffix) {
        Property p = new Property(owner(suffix), "Fixture " + slug + " " + suffix,
                deal, "apartment", price, "Fixture " + slug, "Pune");
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
        listing(slug, "buy", 12_000_000L, new BigDecimal("1000"), "2");
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "3");

        Map<String, Object> row = row(admin(), slug);

        assertThat(row.get("name")).isEqualTo("Fixture " + slug);
        assertThat(num(row, "marketRatePerSqft")).isEqualTo(MARKET_RATE);
        assertThat(num(row, "avgActualRatePerSqft"))
                .as("the mean of the two asking rates, not the curated ₹%d", MARKET_RATE)
                .isEqualTo(11_000L);
        assertThat(num(row, "avgRent")).isEqualTo(AVG_RENT);
        assertThat(num(row, "buyCount")).isEqualTo(2L);
        assertThat(num(row, "rentCount")).isEqualTo(1L);
        assertThat(num(row, "totalListings")).isEqualTo(3L);
        assertThat(num(row, "demand")).isEqualTo((long) DEMAND);
    }

    /**
     * ₹30,000 a month over 1,000 sqft is ₹30 per sqft per month, ₹360 a year, against a capital rate
     * of ₹9,000 — exactly 4%. The report's only figure that combines both halves of the schema, so
     * it is the one that catches a query that annualised the wrong side or forgot to at all: a
     * missing ×12 reports 0.3, and dividing by the monthly rent instead reports something absurd.
     */
    @Test
    void rentalYieldAnnualisesTheAskingRentOverTheCapitalRate() throws Exception {
        String slug = "d999-pricing-yield";
        locality(slug);
        listing(slug, "rent", 30_000L, new BigDecimal("1000"), "4");

        Map<String, Object> row = row(admin(), slug);

        assertThat(((Number) row.get("rentalYieldPct")).doubleValue()).isEqualTo(4.0);
    }

    /**
     * <strong>The regression this endpoint exists for.</strong> The browser version fell back to the
     * curated market rate whenever it had no listings to average, so a locality Draazy has never
     * sold a home in showed a deviation of exactly zero and read as the best-priced place in the
     * city. An empty locality has no asking average, and the report has to say so.
     */
    @Test
    void aLocalityWithNoApprovedListingsReportsNullNotTheMarketRate() throws Exception {
        String slug = "d999-pricing-empty";
        locality(slug);

        Map<String, Object> row = row(admin(), slug);

        assertThat(row)
                .as("the field is present and null, not omitted — an absent key invites a ?? on the client")
                .containsKey("avgActualRatePerSqft");
        assertThat(row.get("avgActualRatePerSqft"))
                .as("no listings means no average, and emphatically not ₹%d", MARKET_RATE)
                .isNull();
        assertThat(row.get("rentalYieldPct"))
                .as("nothing is let here, so there is no yield to report")
                .isNull();
        assertThat(num(row, "marketRatePerSqft"))
                .as("the curated side is still known, which is what makes the null meaningful")
                .isEqualTo(MARKET_RATE);
        assertThat(num(row, "totalListings")).isZero();
        assertThat(num(row, "buyCount")).isZero();
    }

    /**
     * A listing with no usable area is supply without a price signal. It must count as the former
     * and contribute nothing to the latter: coalescing the missing area to zero rupees a square foot
     * would pull this locality's average from ₹11,000 down to ₹5,500 — a 50% drop caused entirely by
     * two owners skipping a form field.
     */
    @Test
    void aListingWithNoUsableAreaDoesNotCorruptTheAverage() throws Exception {
        String slug = "d999-pricing-noarea";
        locality(slug);
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "5");
        listing(slug, "buy", 12_000_000L, new BigDecimal("1000"), "6");
        listing(slug, "buy", 8_000_000L, null, "7");
        listing(slug, "buy", 8_000_000L, BigDecimal.ZERO, "8");

        Map<String, Object> row = row(admin(), slug);

        assertThat(num(row, "avgActualRatePerSqft"))
                .as("averaged over the two listings that carry an area, and only those")
                .isEqualTo(11_000L);
        assertThat(num(row, "buyCount"))
                .as("all four are still listings — supply and the sample are different questions")
                .isEqualTo(4L);
        assertThat(num(row, "totalListings")).isEqualTo(4L);
    }

    /**
     * Locality-by-locality pricing is commercially sensitive and staff-gated. A signed-in seeker is
     * still the public.
     */
    @Test
    void aPlainConsumerIsRefused() throws Exception {
        mvc.perform(get(Routes.Admin.ANALYTICS_PRICING)
                        .header(HttpHeaders.AUTHORIZATION, consumer()))
                .andExpect(status().isForbidden());
    }

    /**
     * The other end of the same guard. Refusing everyone is a way to pass {@link
     * #aPlainConsumerIsRefused()} while the report is unreachable by the team that sources on it, so
     * the acceptance side is asserted too — sourcing is ops work, not an admin-only privilege.
     */
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

    /**
     * The two clauses that keep the report about the catalogue a buyer can actually see. Both are
     * invisible to a fixture that only ever builds approved, non-archived rows: delete either from
     * the query and every other test here still passes, while the report starts pricing a locality
     * off listings nobody can buy — and a withdrawn ₹40,000/sqft outlier moves a mean a long way.
     */
    @Test
    void aPendingOrArchivedListingIsNeitherCountedNorAveraged() throws Exception {
        String slug = "d999-pricing-invisible";
        locality(slug);
        listing(slug, "buy", 10_000_000L, new BigDecimal("1000"), "9");

        Property pending = listing(slug, "buy", 30_000_000L, new BigDecimal("1000"), "a");
        pending.setStatus(PropertyStatus.PENDING);
        properties.saveAndFlush(pending);

        Property archived = listing(slug, "buy", 40_000_000L, new BigDecimal("1000"), "b");
        jdbc.update("update properties set archived = true where id = ?", archived.getId());

        Map<String, Object> row = row(admin(), slug);

        assertThat(num(row, "avgActualRatePerSqft"))
                .as("the one approved listing; ₹30,000 or ₹40,000 per sqft would be unmissable in the mean")
                .isEqualTo(10_000L);
        assertThat(num(row, "buyCount"))
                .as("a listing awaiting review is not supply, and an archived one is gone")
                .isEqualTo(1L);
        assertThat(num(row, "totalListings")).isEqualTo(1L);
    }

    /** An inactive locality is not part of the catalogue and is not part of the report. */
    @Test
    void anInactiveLocalityIsNotReported() throws Exception {
        String slug = "d999-pricing-inactive";
        locality(slug);
        jdbc.update("update localities set active = false where slug = ?", slug);

        String json = mvc.perform(get(Routes.Admin.ANALYTICS_PRICING)
                        .header(HttpHeaders.AUTHORIZATION, admin()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(JsonPath.read(json, "$[?(@.slug=='" + slug + "')]").toString())
                .isEqualTo("[]");
    }
}
