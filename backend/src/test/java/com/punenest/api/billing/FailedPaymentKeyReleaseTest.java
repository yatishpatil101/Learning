package com.punenest.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.billing.boost.BoostRepository;
import com.punenest.api.billing.boost.BoostStatuses;
import com.punenest.api.billing.plan.SubscriptionRepository;
import com.punenest.api.billing.plan.SubscriptionStatuses;
import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.finance.rent.RentPayment;
import com.punenest.api.finance.rent.RentPaymentRepository;
import com.punenest.api.finance.rent.RentPaymentStatuses;
import com.punenest.api.finance.tenancy.Tenancy;
import com.punenest.api.finance.tenancy.TenancyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.cashfree.WebhookSignature;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * A payment that failed releases its idempotency key — D171.
 *
 * <p><strong>The trap this is about.</strong> The key a client sends is not random. The frontend
 * derives it from what is being bought — the tenancy and the month, the plan, the pack — so the key
 * a customer presents on their second attempt is <em>the same key</em> as the first. That is exactly
 * what makes retrying after a decline safe to do and impossible to get right by accident: if the
 * dead row keeps the key, the replay lookup finds it and hands the customer back their own failure,
 * forever, with a {@code 201} on top. They can never buy the thing again. {@code abandonCheckout}
 * already nulled the key for this reason; the {@code fail} paths did not.
 *
 * <p><strong>Why one class for three families.</strong> It is one rule, and the value of stating it
 * once is that the next payment family added is obviously in scope. Each family still gets its own
 * nest, because "failed" is spelled differently in each terminal state — {@code cancelled} for a
 * subscription, {@code expired} for a boost, {@code failed} for rent — and a shared assertion would
 * hide that.
 *
 * <p><strong>The service-request family is deliberately absent.</strong> It carries no idempotency
 * key at all, so it has nothing to release; there is no gap there to cover.
 *
 * <p>Every callback is signed with the real {@link WebhookSignature} bean, as
 * {@code PaymentWebhookTest} argues at length: a signature check that is only ever stubbed is a
 * check nobody has run.
 */
@DisplayName("D171 — a failed payment releases its idempotency key so the customer can retry")
class FailedPaymentKeyReleaseTest extends AbstractApiTest {

    /** Owner Plus, 2499 — priced, so it commits {@code pending} and can be failed. */
    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** 7-day Spotlight, 999. */
    private static final String BOOST_PACK = "b2000000-0000-4000-8000-000000000001";

    private static final long RENT = 28_000L;

    /** Rent plus the 2% fee plus GST on the fee, as {@code PaymentWebhookTest} settles it. */
    private static final String RENT_TOTAL = "28661.00";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenancyRepository tenancies;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired BoostRepository boosts;
    @Autowired RentPaymentRepository payments;
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

    /**
     * The family where getting this wrong costs the most. A tenant's key is derived from the tenancy
     * and the month, so a failed row that kept it would answer every retry for the rest of that
     * month with the same decline — and the partial unique index deliberately excludes {@code
     * failed} precisely so the month <em>is</em> retryable. The key was the only thing still
     * blocking it.
     */
    @Nested
    @DisplayName("rent")
    class Rent {

        @Test
        @DisplayName("after a declined payment the same key opens a fresh payment for the month")
        void aDeclinedRentPaymentCanBeRetriedWithTheSameKey() throws Exception {
            User tenant = user("9877700122", "buyer");
            Tenancy t = tenancy(user("9877700121", "owner"), tenant);
            String key = "rent-2026-03";

            String first = payRent(tenant, t, key);
            decline(field(first, "reference"));

            String second = payRent(tenant, t, key);

            assertThat(field(second, "id")).isNotEqualTo(field(first, "id"));
            assertThat(paymentsOf(tenant.getId()))
                    .extracting(RentPayment::getStatus)
                    .containsExactlyInAnyOrder(RentPaymentStatuses.DUE, RentPaymentStatuses.FAILED);
        }

        /**
         * The other half of the asymmetry, and the reason {@code settle} nulls the key on the failed
         * branch only. A <em>paid</em> row must keep its key: the same derived key arriving again is
         * a duplicate submit, and replaying the receipt is the whole point of idempotency. Releasing
         * it here would open a second live payment for a month already paid — a real double charge,
         * which is a worse bug than the one D171 fixes.
         */
        @Test
        @DisplayName("a paid payment keeps its key, so a retry replays the receipt")
        void aPaidRentPaymentKeepsItsKey() throws Exception {
            User tenant = user("9877700124", "buyer");
            Tenancy t = tenancy(user("9877700123", "owner"), tenant);
            String key = "rent-2026-03";

            String first = payRent(tenant, t, key);
            settle(field(first, "reference"));

            mvc.perform(post(Routes.Rent.PAYMENTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .header("Idempotency-Key", key)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"tenancyId\":\"" + t.getId() + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.id").value(field(first, "id")));

            assertThat(paymentsOf(tenant.getId())).hasSize(1);
        }

        private String payRent(User tenant, Tenancy t, String key) throws Exception {
            return mvc.perform(post(Routes.Rent.PAYMENTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .header("Idempotency-Key", key)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"tenancyId\":\"" + t.getId() + "\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
        }

        private List<RentPayment> paymentsOf(UUID tenantId) {
            return payments.findByTenantId(tenantId, PageRequest.of(0, 100)).getContent();
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

    /** A let flat closed to a tenant, which is what opens the tenancy the rent rail bills on. */
    private Tenancy tenancy(User owner, User tenant) throws Exception {
        Property p = listing(owner);

        mvc.perform(post("/me/deals/" + p.getId() + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":" + RENT + ",\"counterpartyMobile\":\""
                                + tenant.getMobile() + "\"}"))
                .andExpect(status().isOk());

        return tenancies.findActiveByPropertyId(p.getId()).orElseThrow();
    }

    // ---------------------------------------------------------------- the gateway's word

    /** The decline. Every family is offered the event; only the one owning the order acts on it. */
    private void decline(String orderId) throws Exception {
        deliverSigned("{\"type\":\"PAYMENT_FAILED_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"FAILED\","
                + "\"payment_amount\":" + RENT_TOTAL + "},"
                + "\"error_details\":{\"error_description\":\"Insufficient funds\"}}}");
    }

    private void settle(String orderId) throws Exception {
        deliverSigned("{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"SUCCESS\","
                + "\"payment_amount\":" + RENT_TOTAL + ","
                + "\"payment_time\":\"2026-03-05T11:20:00+05:30\"}}}");
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
