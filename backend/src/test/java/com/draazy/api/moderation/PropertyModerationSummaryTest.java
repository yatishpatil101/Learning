package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
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

/**
 * {@code GET /admin/properties/summary} — the console's headline counts, computed by the database.
 *
 * <p><strong>What this endpoint is for.</strong> The console derived these numbers from the rows
 * {@code GET /admin/properties} had already returned. That read pages at 100, so every counter
 * silently meant "of the newest hundred" while being labelled "Total" and "Pending" — and the
 * failure was invisible in exactly the situation the numbers exist for, because a backlog past the
 * page size simply stopped counting and looked calm.
 *
 * <p><strong>Every assertion here is a delta, not an absolute.</strong> The counters are unfiltered
 * by design — they describe the whole table — so their absolute values depend on whatever else the
 * suite has left behind. Asserting {@code total == 4} would make this test a report on its
 * neighbours. Reading the summary before and after, and asserting how much it moved, tests the
 * thing that actually matters and cannot be broken by test ordering.
 *
 * <p><strong>Statuses are exactly {@code pending|approved|rejected|flagged|archived|sold|rented}.</strong>
 * The first draft of this test tried to insert {@code 'Under Review'}, because the console treats
 * it as a real alternative to {@code pending} in every tab that looks for waiting work.
 * {@code properties_status_check} rejected the row. It is a mock-side spelling that no API response
 * can ever carry.
 */
@DisplayName("D214 — the moderation summary counts the table, not the page")
class PropertyModerationSummaryTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

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

    /**
     * The counters move by exactly what was added, and each lands on its own tile. One listing per
     * status, so a query that dropped or duplicated a {@code filter (where ...)} clause shows up as
     * the wrong tile moving rather than as a plausible-looking total.
     */
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

    /**
     * A closed deal is still inventory, but it is not work. {@code sold} and {@code rented} belong
     * in {@code total} and on no tile of their own — a moderation strip that broke them out would
     * be offering a queue nobody ever drains.
     *
     * <p>This also pins the absence of {@code 'Under Review'}. The console tests for it everywhere
     * it looks for a waiting listing, but {@code properties_status_check} allows only
     * {@code pending|approved|rejected|flagged|archived|sold|rented}, so the database refuses the
     * row: it was a mock-side spelling, and the second half of every
     * {@code status === 'pending' || status === 'Under Review'} in the console is unreachable
     * against the API.
     */
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

    /**
     * The stays-live re-check (Q14) is its own counter because the rows in it raise no other one:
     * they are approved, un-archived and in search, so a moderator watching {@code pending} would
     * never learn the queue existed.
     */
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

    /**
     * Archived is the one counter outside the {@code not archived} floor. If it were inside
     * {@code total}, the tiles would disagree with the table under them, which lists live inventory.
     */
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

    /**
     * Same lock as the queue. The counts are a coarser view of rows {@code GET /admin/properties}
     * already returns, so a weaker guard here would be no guard — a buyer who cannot see the
     * backlog must not be able to measure it either.
     */
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
