package com.draazy.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.plan.SubscriptionRepository;
import com.draazy.api.billing.plan.SubscriptionSweeper;
import com.draazy.api.billing.plan.SubscriptionStatuses;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.support.AbstractApiTest;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@DisplayName("D161 — abandoned subscription checkouts are retired")
class BillingCheckoutSweepTest extends AbstractApiTest {

    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired SubscriptionSweeper subscriptionSweeper;
    @Autowired WebhookSignature webhookSignature;

    @Nested
    @DisplayName("subscriptions")
    class Subscriptions {

        /** A guard on {@code paymentRef == null} would skip exactly these rows: the order was
         *  opened, the customer just closed the modal. */
        @Test
        @DisplayName("a pending order past its TTL is cancelled once, and the customer can buy again")
        void staleOrdersAreCancelled() throws Exception {
            User u = owner("9866600101");
            // The whole point: the unpaid-order cap no longer holds a customer who never came back.
            subscribe(u, 201);

            assertThat(subscriptionSweeper.expireAbandonedCheckouts(future())).isEqualTo(1);
            assertThat(subscriptionSweeper.expireAbandonedCheckouts(future())).isZero();

            assertThat(statusOfLatestSubscription(u)).isEqualTo(SubscriptionStatuses.CANCELLED);

            subscribe(u, 201);
        }

        @Test
        @DisplayName("an order still inside its TTL is left alone")
        void freshOrdersSurvive() throws Exception {
            User u = owner("9866600102");
            subscribe(u, 201);

            assertThat(subscriptionSweeper.expireAbandonedCheckouts(past())).isZero();

            assertThat(statusOfLatestSubscription(u)).isEqualTo(SubscriptionStatuses.PENDING);
        }

        @Test
        @DisplayName("an active subscription is never touched, however old it is")
        void paidSubscriptionsAreUntouchable() throws Exception {
            User u = owner("9866600103");
            deliverSigned(subscribeAndReadRef(u));

            assertThat(subscriptionSweeper.expireAbandonedCheckouts(future())).isZero();

            assertThat(statusOfLatestSubscription(u)).isEqualTo(SubscriptionStatuses.ACTIVE);
        }
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Sweep User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Instant future() {
        return Instant.now().plus(Duration.ofMinutes(5));
    }

    private Instant past() {
        return Instant.now().minus(Duration.ofHours(1));
    }

    private void subscribe(User caller, int expected) throws Exception {
        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + PAID_PLAN + "\"}"))
                .andExpect(status().is(expected));
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

    /** Read through the repository, not {@code jdbc}: the sweep mutates managed entities and only a
     *  JPA query forces the flush that makes its work visible. */
    private String statusOfLatestSubscription(User u) {
        return subscriptions.findByUserIdOrderByStartedAtDesc(u.getId())
                .getFirst().getStatus();
    }

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }
}
