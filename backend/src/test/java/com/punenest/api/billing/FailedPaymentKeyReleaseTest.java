package com.punenest.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.billing.boost.BoostRepository;
import com.punenest.api.billing.boost.BoostStatuses;
import com.punenest.api.billing.plan.SubscriptionRepository;
import com.punenest.api.billing.plan.SubscriptionStatuses;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.cashfree.WebhookSignature;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * A payment that failed releases its idempotency key — D171.
 *
 * <p><strong>The trap this is about.</strong> The key a client sends is not random. The frontend
 * derives it from what is being bought — the plan, the pack — so the key
 * a customer presents on their second attempt is <em>the same key</em> as the first. That is exactly
 * what makes retrying after a decline safe to do and impossible to get right by accident: if the
 * dead row keeps the key, the replay lookup finds it and hands the customer back their own failure,
 * forever, with a {@code 201} on top. They can never buy the thing again. {@code abandonCheckout}
 * already nulled the key for this reason; the {@code fail} paths did not.
 *
 * <p><strong>Why one class for two families.</strong> It is one rule, and the value of stating it
 * once is that the next payment family added is obviously in scope. Each family still gets its own
 * nest, because "failed" is spelled differently in each terminal state — {@code cancelled} for a
 * subscription, {@code expired} for a boost — and a shared assertion would hide that.
 *
 * <p><strong>The service-request family is deliberately absent.</strong> It carries no idempotency
 * key at all, so it has nothing to release; there is no gap there to cover.
 *
 * <p>Every callback is signed with the real {@link WebhookSignature} bean: a signature check that is
 * only ever stubbed is a check nobody has run.
 */
@DisplayName("D171 — a failed payment releases its idempotency key so the customer can retry")
class FailedPaymentKeyReleaseTest extends AbstractApiTest {

    /** Owner Plus, 2499 — priced, so it commits {@code pending} and can be failed. */
    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** 7-day Spotlight, 999. */
    private static final String BOOST_PACK = "b2000000-0000-4000-8000-000000000001";

    private static final long RENT = 28_000L;

    /**
     * The figure carried on the callback body. Not asserted anywhere: the decline branch settles on
     * the order id alone, so this only has to parse.
     */
    private static final String WEBHOOK_AMOUNT = "2499.00";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired BoostRepository boosts;
    @Autowired WebhookSignature webhookSignature;

    @Nested
    @DisplayName("subscriptions")
    class Subscriptions {

        /**
         * The failure this fixes, end to end. Without the key release the second call replays the
         * cancelled row: {@code 201}, same id, no new order, and a customer whose card worked on the
         * second try is still not subscribed.
         */
        @Test
        @DisplayName("after a declined payment the same key opens a fresh order")
        void aDeclinedSubscriptionCanBeRetriedWithTheSameKey() throws Exception {
            User u = user("9877700101", "owner");
            String key = "plan-owner-plus";

            String first = subscribe(u, key);
            decline(field(first, "paymentRef"));

            String second = subscribe(u, key);

            assertThat(field(second, "id")).isNotEqualTo(field(first, "id"));
            assertThat(field(second, "status")).isEqualTo(SubscriptionStatuses.PENDING);
            assertThat(subscriptions.findByUserIdOrderByStartedAtDesc(u.getId())).hasSize(2);
        }

        /**
         * The dead row is not resurrected or overwritten — it stays cancelled as the audit of what
         * happened. Releasing the key must free the customer, not rewrite history.
         */
        @Test
        @DisplayName("the declined subscription stays cancelled")
        void theDeclinedRowIsLeftAsHistory() throws Exception {
            User u = user("9877700102", "owner");
            String key = "plan-owner-plus";

            String first = subscribe(u, key);
            decline(field(first, "paymentRef"));
            subscribe(u, key);

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

    @Nested
    @DisplayName("boosts")
    class Boosts {

        @Test
        @DisplayName("after a declined payment the same key opens a fresh order")
        void aDeclinedBoostCanBeRetriedWithTheSameKey() throws Exception {
            User u = user("9877700111", "owner");
            Property p = listing(u);
            String key = "boost-spotlight-7";

            String first = boost(u, p, key);
            decline(field(first, "paymentRef"));

            String second = boost(u, p, key);

            assertThat(field(second, "id")).isNotEqualTo(field(first, "id"));
            assertThat(boosts.findByPropertyIdOrderByCreatedAtDesc(p.getId())).hasSize(2);
        }

        /**
         * A declined boost must not have promoted anything on its way out, and the retry must not
         * inherit a ranking the owner has still not paid for.
         */
        @Test
        @DisplayName("neither the declined boost nor its retry promotes the listing")
        void aDeclinedBoostNeverRanksTheListing() throws Exception {
            User u = user("9877700112", "owner");
            Property p = listing(u);
            String key = "boost-spotlight-7";

            decline(field(boost(u, p, key), "paymentRef"));
            boost(u, p, key);

            assertThat(properties.findById(p.getId()).orElseThrow().getBoostedUntil()).isNull();
            assertThat(boosts.findByPropertyIdOrderByCreatedAtDesc(p.getId()).getFirst().getStatus())
                    .isEqualTo(BoostStatuses.PENDING);
        }

        private String boost(User caller, Property listing, String key) throws Exception {
            return mvc.perform(post(Routes.Boosts.LISTING, listing.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                            .header("Idempotency-Key", key)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"packId\":\"" + BOOST_PACK + "\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
        }
    }

    // ---------------------------------------------------------------- fixtures

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Retry User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Boostable flat", "rent", "apartment", RENT,
                "Baner", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("950"));
        return properties.saveAndFlush(p);
    }

    // ---------------------------------------------------------------- the gateway's word

    /** The decline. Every family is offered the event; only the one owning the order acts on it. */
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

    /** Same flat read the sibling suites use; a JSON path library would be a dependency, not a win. */
    private static String field(String body, String name) {
        int i = body.indexOf("\"" + name + "\":\"") + name.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }
}
