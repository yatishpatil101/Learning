package com.draazy.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.plan.SubscriptionRepository;
import com.draazy.api.billing.plan.SubscriptionStatuses;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** The client derives the idempotency key from what is being bought, so a retry after a decline
 *  presents the same key — a dead row that keeps it replays the failure forever, with a 201 on top. */
@DisplayName("D171 — a failed payment releases its idempotency key so the customer can retry")
class FailedPaymentKeyReleaseTest extends AbstractApiTest {

    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** Not asserted anywhere — the decline branch settles on the order id alone, so it only parses. */
    private static final String WEBHOOK_AMOUNT = "999.00";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired WebhookSignature webhookSignature;

    @Nested
    @DisplayName("subscriptions")
    class Subscriptions {

        /** Without the key release the second call replays the cancelled row: 201, same id, no new
         *  order, and a card that worked on the second try is still not subscribed. Releasing the
         *  key must free the customer, not rewrite the audit of what happened. */
        @Test
        @DisplayName("after a declined payment the same key opens a fresh order and the declined row stays cancelled")
        void aDeclinedSubscriptionCanBeRetriedWithTheSameKey() throws Exception {
            User u = user("9877700101", "owner");
            String key = "plan-owner-plus";

            String first = subscribe(u, key);
            decline(field(first, "paymentRef"));

            String second = subscribe(u, key);

            assertThat(field(second, "id")).isNotEqualTo(field(first, "id"));
            assertThat(field(second, "status")).isEqualTo(SubscriptionStatuses.PENDING);
            assertThat(subscriptions.findByUserIdOrderByStartedAtDesc(u.getId()))
                    .extracting(s -> s.getStatus())
                    .containsExactlyInAnyOrder(
                            SubscriptionStatuses.PENDING, SubscriptionStatuses.CANCELLED);
        }

        private String subscribe(User caller, String key) throws Exception {
            return mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .header("Idempotency-Key", key)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"planId\":\"" + PAID_PLAN + "\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
        }
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Retry User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** Every family is offered the event; only the one owning the order acts on it. */
    private void decline(String orderId) throws Exception {
        deliverSigned("{\"type\":\"PAYMENT_FAILED_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"FAILED\","
                + "\"payment_amount\":" + WEBHOOK_AMOUNT + "},"
                + "\"error_details\":{\"error_description\":\"Insufficient funds\"}}}");
    }

    private void deliverSigned(String body) throws Exception {
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private static String field(String body, String name) {
        int i = body.indexOf("\"" + name + "\":\"") + name.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }
}
