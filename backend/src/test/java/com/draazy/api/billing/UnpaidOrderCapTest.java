package com.draazy.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.plan.SubscriptionStatuses;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@DisplayName("D160 — one outstanding unpaid subscription order per user")
class UnpaidOrderCapTest extends AbstractApiTest {

    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** Free, so it never opens an order and the cap must not apply to it. */
    private static final String FREE_PLAN = "b1000000-0000-4000-8000-000000000001";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired WebhookSignature webhookSignature;

    @Test
    @DisplayName("the index exists under the exact name the service translates on")
    void indexNamesMatchTheConstantsTheServicesMatchOn() {

        assertThat(indexExists("uq_subscriptions_open_unpaid"))
                .as("SubscriptionService.OPEN_UNPAID_INDEX must name a real index")
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
        @DisplayName("a second priced order is refused by the count, naming two real actions, and nothing is inserted")
        void theCountRefusesTheDoubleClick() throws Exception {
            User u = owner("9866600001");
            subscribe(u, PAID_PLAN, 201);

            mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                            .header(HttpHeaders.AUTHORIZATION, bearer(u))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"planId\":\"" + PAID_PLAN + "\"}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", containsString("Finish paying")))
                    // ...or wait, because the sweep clears it.
                    .andExpect(jsonPath("$.message", containsString("expire")));

            // Still one row: the count answered before the insert, so no constraint was reached and
            // this transaction is still usable.
            assertThat(pendingSubscriptions(u)).isEqualTo(1);
        }

        /** A raw INSERT is what a lost race amounts to: a second row arriving after the count read
         *  zero. Without {@code uq_subscriptions_open_unpaid} it would succeed. */
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

            subscribe(u, PAID_PLAN, 201);
            assertThat(pendingSubscriptions(u)).isEqualTo(1);
        }

        @Test
        @DisplayName("a free plan opens no order, so the cap does not apply to it")
        void freePlansAreNotCapped() throws Exception {
            User u = owner("9866600006");
            subscribe(u, FREE_PLAN, 201);

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
            // whose response it never saw is given the order it already has.
            assertThat(jsonField(again, "id")).isEqualTo(jsonField(first, "id"));
            assertThat(pendingSubscriptions(u)).isEqualTo(1);
        }
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Cap User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

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

    private void deliverSigned(String orderId) throws Exception {
        String paidAt = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Kolkata"))
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX"));
        String body = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"SUCCESS\","
                + "\"payment_amount\":999.00,"
                + "\"payment_time\":\"" + paidAt + "\"}}}";
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private void insertPendingSubscription(User u) {
        jdbc.update("insert into subscriptions (user_id, plan_id, status, amount) "
                        + "select ?, p.id, ?, p.price from plans p where p.id = ?",
                u.getId(), SubscriptionStatuses.PENDING, UUID.fromString(PAID_PLAN));
    }

    private int pendingSubscriptions(User u) {
        return count("select count(*) from subscriptions where user_id = ? and status = ?",
                u.getId(), SubscriptionStatuses.PENDING);
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
