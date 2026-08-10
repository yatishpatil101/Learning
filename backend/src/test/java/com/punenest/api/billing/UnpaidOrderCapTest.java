package com.punenest.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.billing.boost.BoostStatuses;
import com.punenest.api.billing.plan.SubscriptionStatuses;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.cashfree.WebhookSignature;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The unpaid-order cap on subscriptions and boosts, and the floor under it — D160.
 *
 * <p><strong>What was wrong.</strong> {@code POST /me/subscription} and
 * {@code POST /me/properties/&#123;id&#125;/boost} each open a live Cashfree order per call and
 * neither bounded how many a customer could hold. {@code WriteRateLimitFilter} caps the <em>rate</em>
 * and {@code Idempotency-Key} is optional, so a loop that simply omits the header opened unbounded
 * real orders against a real gateway. The services desk had already been given this cap (D153); the
 * other two priced paths had not.
 *
 * <p><strong>Why both a count and an index.</strong> The count in the service is the fast path: it
 * answers the ordinary double click before anything is inserted, so the customer gets a sentence
 * they can act on rather than a bare constraint error. It is a check-then-act read over rows that do
 * not exist yet, so N concurrent callers all see zero — which is why the partial unique index is
 * what actually holds. Both are proved separately below, because a suite that only exercises the
 * count would pass with the index dropped, and that is precisely the D153 defect.
 *
 * <p><strong>No threads</strong> — the same reasoning as {@code ServiceRequestUnpaidExitTest}. A
 * race reproduced with threads is a race reproduced <em>sometimes</em>. What the fix adds is a
 * constraint, and a constraint does not depend on timing: the second row is refused whether it
 * arrives a millisecond later or a day later. So the tests insert the second row directly, past the
 * service's count, and assert the database's own answer.
 */
@DisplayName("D160 — one outstanding unpaid order per user, on subscriptions and boosts")
class UnpaidOrderCapTest extends AbstractApiTest {

    /** Seeded by {@code R__seed_reference_data.sql}. Owner Plus, 2499 — priced, so it is capped. */
    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** Free, so it never opens an order and the cap must not apply to it. */
    private static final String FREE_PLAN = "b1000000-0000-4000-8000-000000000001";

    /** 7-day Spotlight, 999. */
    private static final String BOOST_PACK = "b2000000-0000-4000-8000-000000000001";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired WebhookSignature webhookSignature;

    @Test
    @DisplayName("both indexes exist under the exact names the services translate on")
    void indexNamesMatchTheConstantsTheServicesMatchOn() {
        // Each service turns a constraint violation into its 409 by matching the index name inside
        // the driver's message, and nothing else connects the two: rename the index in a later
        // migration and the translation silently stops recognising its own constraint, so the cap
        // starts answering 500 instead of 409. The tests below cannot catch that -- they would still
        // see a rejection, just the wrong one -- so the names are pinned here, once, on both sides.
        assertThat(indexExists("uq_subscriptions_open_unpaid"))
                .as("SubscriptionService.OPEN_UNPAID_INDEX must name a real index")
                .isTrue();
        assertThat(indexExists("uq_boosts_open_unpaid"))
                .as("BoostService.OPEN_UNPAID_INDEX must name a real index")
                .isTrue();
    }

    private boolean indexExists(String name) {
        Integer found = jdbc.queryForObject(
                "select count(*) from pg_indexes where indexname = ?", Integer.class, name);
        return found != null && found > 0;
    }

    @Nested
    @DisplayName("subscriptions")
    class Subscriptions {

        @Test
        @DisplayName("a second priced order is refused by the count, and nothing is inserted")
        void theCountRefusesTheDoubleClick() throws Exception {
            User u = owner("9866600001");
            subscribe(u, PAID_PLAN, 201);

            subscribe(u, PAID_PLAN, 409);

            // Still one row: the count answered before the insert, so no constraint was reached and
            // this transaction is still usable — which is what makes the fast path worth having.
            assertThat(pendingSubscriptions(u)).isEqualTo(1);
        }

        /**
         * Bypasses the service entirely. A raw INSERT is what a lost race amounts to: a second row
         * arriving after the count read zero. Without {@code uq_subscriptions_open_unpaid} this
         * would succeed, which is the unbounded-orders outcome D160 records.
         */
        @Test
        @DisplayName("a second open unpaid row is refused by the database, not just by the service")
        void theDatabaseRefusesTheSecondRow() throws Exception {
            User u = owner("9866600002");
            subscribe(u, PAID_PLAN, 201);

            // Nothing may follow: a constraint violation leaves the transaction rollback-only.
            assertThatThrownBy(() -> insertPendingSubscription(u))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }

        @Test
        @DisplayName("the index is scoped to one user and nothing wider")
        void theIndexIsNarrow() throws Exception {
            User first = owner("9866600003");
            User second = owner("9866600004");
            subscribe(first, PAID_PLAN, 201);

            // Somebody else's unpaid order is not in conflict with this one.
            insertPendingSubscription(second);

            assertThat(pendingSubscriptions(first)).isEqualTo(1);
            assertThat(pendingSubscriptions(second)).isEqualTo(1);
        }

        @Test
        @DisplayName("a paid order leaves the predicate, so the next one is free to open")
        void settledOrdersLeaveTheIndex() throws Exception {
            User u = owner("9866600005");
            String orderId = subscribeAndReadRef(u);
            deliverSigned(orderId);

            // Active, so out of the partial index and out of the count. The cap is on outstanding
            // orders, not on how many a customer may ever buy.
            subscribe(u, PAID_PLAN, 201);
            assertThat(pendingSubscriptions(u)).isEqualTo(1);
        }

        @Test
        @DisplayName("a free plan opens no order, so the cap does not apply to it")
        void freePlansAreNotCapped() throws Exception {
            User u = owner("9866600006");
            subscribe(u, FREE_PLAN, 201);

            // Nothing is pending — a free plan activates immediately — so this is not the cap being
            // skipped, it is the cap having nothing to count. Both must stay true together.
            assertThat(pendingSubscriptions(u)).isZero();
            subscribe(u, FREE_PLAN, 201);
        }

        @Test
        @DisplayName("an Idempotency-Key replay returns the original rather than tripping the cap")
        void theReplayStillWorks() throws Exception {
            User u = owner("9866600007");
            String first = subscribeWithKey(u, "sub-cap-replay", 201);
            String again = subscribeWithKey(u, "sub-cap-replay", 201);

            // The replay is answered before the cap is consulted, so a client retrying a request
            // whose response it never saw is not told it already has an order — it is given the one
            // it already has.
            assertThat(jsonField(again, "id")).isEqualTo(jsonField(first, "id"));
            assertThat(pendingSubscriptions(u)).isEqualTo(1);
        }

        @Test
        @DisplayName("the 409 names two things the customer can actually do")
        void theMessageNamesRealActions() throws Exception {
            User u = owner("9866600008");
            subscribe(u, PAID_PLAN, 201);

            mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                            .header(HttpHeaders.AUTHORIZATION, bearer(u))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"planId\":\"" + PAID_PLAN + "\"}"))
                    .andExpect(status().isConflict())
                    // Finish the checkout they have...
                    .andExpect(jsonPath("$.message", containsString("Finish paying")))
                    // ...or wait, because the sweep clears it. Both are real; a message naming an
                    // action the customer cannot take is worse than no message (D152).
                    .andExpect(jsonPath("$.message", containsString("expire")));
        }
    }

    @Nested
    @DisplayName("boosts")
    class Boosts {

        @Test
        @DisplayName("a second priced boost is refused by the count, and nothing is inserted")
        void theCountRefusesTheDoubleClick() throws Exception {
            User u = owner("9866600010");
            Property p = listing(u);
            boost(u, p, 201);

            boost(u, p, 409);

            assertThat(pendingBoosts(u)).isEqualTo(1);
        }

        @Test
        @DisplayName("a second open unpaid row is refused by the database, not just by the service")
        void theDatabaseRefusesTheSecondRow() throws Exception {
            User u = owner("9866600011");
            Property p = listing(u);
            boost(u, p, 201);
            Property second = listing(u);

            assertThatThrownBy(() -> insertPendingBoost(u, second))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }

        /**
         * The deliberate product difference from the idempotency key, which V23 scoped to the
         * listing. A retry key may be per-listing because it identifies one attempt; a cap may not,
         * because a bound that grows with how many listings someone can create is not a bound.
         */
        @Test
        @DisplayName("the cap is per buyer, so a second listing does not get its own allowance")
        void theCapIsPerBuyerNotPerListing() throws Exception {
            User u = owner("9866600012");
            boost(u, listing(u), 201);

            boost(u, listing(u), 409);
        }

        @Test
        @DisplayName("the index is scoped to one buyer and nothing wider")
        void theIndexIsNarrow() throws Exception {
            User first = owner("9866600013");
            User second = owner("9866600014");
            boost(first, listing(first), 201);

            insertPendingBoost(second, listing(second));

            assertThat(pendingBoosts(first)).isEqualTo(1);
            assertThat(pendingBoosts(second)).isEqualTo(1);
        }

        @Test
        @DisplayName("a paid boost leaves the predicate, so the next one is free to open")
        void settledBoostsLeaveTheIndex() throws Exception {
            User u = owner("9866600015");
            String orderId = boostAndReadRef(u, listing(u));
            deliverSigned(orderId);

            boost(u, listing(u), 201);
            assertThat(pendingBoosts(u)).isEqualTo(1);
        }

        @Test
        @DisplayName("the 409 says where the held order is, since it may be on another listing")
        void theMessagePointsAtTheHeldOrder() throws Exception {
            User u = owner("9866600016");
            boost(u, listing(u), 201);
            Property second = listing(u);

            mvc.perform(post(Routes.Boosts.LISTING, second.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(u))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"packId\":\"" + BOOST_PACK + "\"}"))
                    .andExpect(status().isConflict())
                    // An owner refused while looking at a listing they have never boosted has no
                    // way to guess where the held order is unless the message says so.
                    .andExpect(jsonPath("$.message", containsString("one of your")))
                    .andExpect(jsonPath("$.message", containsString("Finish paying")));
        }
    }

    // ---------------------------------------------------------------- fixtures

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Cap User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Boostable flat", "rent", "apartment", 26_000L,
                "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        return properties.saveAndFlush(p);
    }

    // ---------------------------------------------------------------- actions

    private void subscribe(User caller, String planId, int expected) throws Exception {
        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + planId + "\"}"))
                .andExpect(status().is(expected));
    }

    private String subscribeWithKey(User caller, String key, int expected) throws Exception {
        return mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .header("Idempotency-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + PAID_PLAN + "\"}"))
                .andExpect(status().is(expected))
                .andReturn().getResponse().getContentAsString();
    }

    private String subscribeAndReadRef(User caller) throws Exception {
        String body = mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + PAID_PLAN + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return jsonField(body, "paymentRef");
    }

    private void boost(User caller, Property listing, int expected) throws Exception {
        mvc.perform(post(Routes.Boosts.LISTING, listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packId\":\"" + BOOST_PACK + "\"}"))
                .andExpect(status().is(expected));
    }

    private String boostAndReadRef(User caller, Property listing) throws Exception {
        String body = mvc.perform(post(Routes.Boosts.LISTING, listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packId\":\"" + BOOST_PACK + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return jsonField(body, "paymentRef");
    }

    /** The nested payload Cashfree actually sends, signed with the real HMAC. */
    private void deliverSigned(String orderId) throws Exception {
        String paidAt = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Kolkata"))
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX"));
        String body = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"SUCCESS\","
                + "\"payment_amount\":2499.00,"
                + "\"payment_time\":\"" + paidAt + "\"}}}";
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    // ---------------------------------------------------------------- state

    private void insertPendingSubscription(User u) {
        jdbc.update("insert into subscriptions (user_id, plan_id, status) values (?, ?, ?)",
                u.getId(), UUID.fromString(PAID_PLAN), SubscriptionStatuses.PENDING);
    }

    private void insertPendingBoost(User buyer, Property listing) {
        jdbc.update("insert into boosts (property_id, buyer_id, pack_id, status) "
                        + "values (?, ?, ?, ?)",
                listing.getId(), buyer.getId(), UUID.fromString(BOOST_PACK),
                BoostStatuses.PENDING);
    }

    private int pendingSubscriptions(User u) {
        return count("select count(*) from subscriptions where user_id = ? and status = ?",
                u.getId(), SubscriptionStatuses.PENDING);
    }

    private int pendingBoosts(User u) {
        return count("select count(*) from boosts where buyer_id = ? and status = ?",
                u.getId(), BoostStatuses.PENDING);
    }

    private int count(String sql, Object... args) {
        Integer count = jdbc.queryForObject(sql, Integer.class, args);
        return count == null ? 0 : count;
    }

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }
}
