package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.draazy.api.billing.plan.TestPlanGrants;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

// `GET /admin/properties/summary` ? the console's headline counts, computed by the database.
// Counters describe the whole table, so absolute values depend on shared suite data.
@DisplayName("D214 — the moderation summary counts the table, not the page")
class PropertyModerationSummaryTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    TestPlanGrants grants;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Summary " + mobile);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title, String status) {
        Property p = new Property(owner, title, "rent", "apartment", 26000L, "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    /** The raw response body; {@link #moved} reads individual counters back out of it. */
    private String summary(User staff) throws Exception {
        return mvc.perform(get("/admin/properties/summary")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    // One listing per status makes dropped or duplicated filters move the wrong tile.
    @Test
    @DisplayName("each status lands on its own counter")
    void eachStatusLandsOnItsOwnCounter() throws Exception {
        User owner = user("9851000001", "owner");
        User staff = user("9851000002", "staff");
        String before = summary(staff);

        listing(owner, "Summary pending", PropertyStatus.PENDING);
        listing(owner, "Summary rejected", PropertyStatus.REJECTED);
        listing(owner, "Summary flagged", PropertyStatus.FLAGGED);
        listing(owner, "Summary approved", PropertyStatus.APPROVED);

        String after = summary(staff);
        moved(before, after, "total", 4);
        moved(before, after, "pending", 1);
        moved(before, after, "flagged", 1);
        moved(before, after, "approved", 1);

        // `rejected` has no tile of its own — it is in `total` and nowhere else, which is why
        // `total` moves by four while the three named counters account for only three of them.
    }

    @Test
    @DisplayName("featured counts the live listings of owners on a paid Owner plan (D292)")
    void featuredFollowsThePaidPlan() throws Exception {
        User free = user("9851000011", "owner");
        User paying = user("9851000012", "owner");
        grants.grant(paying.getId(), TestPlanGrants.OWNER_PLUS);
        User staff = user("9851000013", "staff");
        String before = summary(staff);

        listing(free, "Summary free owner", PropertyStatus.APPROVED);
        listing(paying, "Summary paying owner", PropertyStatus.APPROVED);

        moved(before, summary(staff), "featured", 1);
    }

    // `sold` and `rented` count only in total; separate tiles would be undrainable queues.
    // This also pins the absence of `'Under Review'`.
    @Test
    @DisplayName("a closed deal counts in total and on no queue tile")
    void closedDealsCountInTotalOnly() throws Exception {
        User owner = user("9851000003", "owner");
        User staff = user("9851000004", "staff");
        String before = summary(staff);

        listing(owner, "Summary sold", PropertyStatus.SOLD);
        listing(owner, "Summary rented", PropertyStatus.RENTED);

        String after = summary(staff);
        moved(before, after, "total", 2);
        moved(before, after, "pending", 0);
        moved(before, after, "approved", 0);
    }

    // Stays-live rows are approved, unarchived and searchable,
    // so `pending` counters never reveal that queue.
    @Test
    @DisplayName("a queued re-check counts as recheck while still counting as approved")
    void recheckIsCountedSeparatelyFromApproved() throws Exception {
        User owner = user("9851000005", "owner");
        User staff = user("9851000006", "staff");
        String before = summary(staff);

        Property p = listing(owner, "Summary recheck", PropertyStatus.APPROVED);
        p.requestRecheck(List.of("price"));
        properties.saveAndFlush(p);

        String after = summary(staff);
        moved(before, after, "recheck", 1);
        moved(before, after, "approved", 1);
    }

    // Archived is the one counter outside the `not archived` floor.
    @Test
    @DisplayName("a badge-only request counts as a badge request, not a re-check")
    void badgeRequestIsNotARecheck() throws Exception {
        User owner = user("9851000015", "owner");
        User staff = user("9851000016", "staff");
        String before = summary(staff);

        Property p = listing(owner, "Summary badge", PropertyStatus.APPROVED);
        p.requestOwnershipReview(java.time.Instant.now());
        properties.saveAndFlush(p);

        String after = summary(staff);
        moved(before, after, "badgeRequests", 1);
        moved(before, after, "recheck", 0);
    }

    @Test
    @DisplayName("archived is counted apart and stays out of total")
    void archivedIsCountedApartAndStaysOutOfTotal() throws Exception {
        User owner = user("9851000007", "owner");
        User staff = user("9851000008", "staff");
        String before = summary(staff);

        Property p = listing(owner, "Summary archived", PropertyStatus.APPROVED);
        p.archive("summary test");
        properties.saveAndFlush(p);

        String after = summary(staff);
        moved(before, after, "archived", 1);
        moved(before, after, "total", 0);
        moved(before, after, "approved", 0);
    }

    // Summary counts reveal the backlog size, so they need the same guard as queue rows.
    @Test
    @DisplayName("a buyer cannot measure the backlog")
    void buyerCannotMeasureTheBacklog() throws Exception {
        User buyer = user("9851000009", "buyer");

        mvc.perform(get("/admin/properties/summary")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
    }

    /** Reads one counter from each summary and asserts the difference, naming the tile on failure. */
    private void moved(String before, String after, String counter, long expected) {
        long delta = counter(after, counter) - counter(before, counter);
        org.junit.jupiter.api.Assertions.assertEquals(expected, delta,
                () -> "counter '" + counter + "' moved by " + delta + ", expected " + expected);
    }

    private static long counter(String body, String name) {
        return ((Number) JsonPath.read(body, "$." + name)).longValue();
    }
}
