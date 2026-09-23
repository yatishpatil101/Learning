package com.draazy.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.boost.BoostRepository;
import com.draazy.api.billing.boost.BoostService;
import com.draazy.api.billing.boost.BoostStatuses;
import com.draazy.api.billing.plan.SubscriptionRepository;
import com.draazy.api.billing.plan.SubscriptionSweeper;
import com.draazy.api.billing.plan.SubscriptionStatuses;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** Driven by a fabricated cutoff instant so no test waits; the scheduler itself is disabled in the
 *  test profile. The exit state is per family — subscriptions cancel, boosts expire. */
@DisplayName("D161 — abandoned subscription and boost checkouts are retired")
class BillingCheckoutSweepTest extends AbstractApiTest {

    /** Owner Plus, 999 — priced, so it commits {@code pending} and can be stranded. */
    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** 7-day Spotlight, 999. */
    private static final String BOOST_PACK = "b2000000-0000-4000-8000-000000000001";

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired BoostRepository boosts;
    @Autowired SubscriptionSweeper subscriptionSweeper;
    @Autowired BoostService boostService;
    @Autowired WebhookSignature webhookSignature;

    @Nested
    @DisplayName("subscriptions")
    class Subscriptions {

        @Test
        @DisplayName("a pending order past its TTL is cancelled, and the customer can buy again")
        void staleOrdersAreCancelled() throws Exception {
            User u = owner("9866600101");
            subscribe(u, 201);

            assertThat(subscriptionSweeper.expireAbandonedCheckouts(future())).isEqualTo(1);

            assertThat(statusOfLatestSubscription(u)).isEqualTo(SubscriptionStatuses.CANCELLED);
            // The whole point: the unpaid-order cap no longer holds a customer who never came back.
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

        @Test
        @DisplayName("a second pass over the same rows cancels nothing further")
        void theSweepIsIdempotent() throws Exception {
            subscribe(owner("9866600104"), 201);

            assertThat(subscriptionSweeper.expireAbandonedCheckouts(future())).isEqualTo(1);
            assertThat(subscriptionSweeper.expireAbandonedCheckouts(future())).isZero();
        }

        /** A guard on {@code paymentRef == null} would skip exactly these rows: the order was
         *  opened, the customer just closed the modal. */
        @Test
        @DisplayName("a row that already carries a gateway order is swept, not skipped")
        void rowsWithAnOrderAreSweptToo() throws Exception {
            User u = owner("9866600105");
            String orderId = subscribeAndReadRef(u);
            assertThat(orderId).isNotBlank();

            assertThat(subscriptionSweeper.expireAbandonedCheckouts(future())).isEqualTo(1);
            assertThat(statusOfLatestSubscription(u)).isEqualTo(SubscriptionStatuses.CANCELLED);
        }
    }

    @Nested
    @DisplayName("boosts")
    class Boosts {

        @Test
        @DisplayName("a pending boost past its TTL expires, and the owner can buy again")
        void staleBoostsExpire() throws Exception {
            User u = owner("9866600110");
            Property p = listing(u);
            boost(u, p, 201);

            assertThat(boostService.expireAbandonedCheckouts(future())).isEqualTo(1);

            assertThat(statusOfLatestBoost(p)).isEqualTo(BoostStatuses.EXPIRED);
            boost(u, p, 201);
        }

        @Test
        @DisplayName("a boost still inside its TTL is left alone")
        void freshBoostsSurvive() throws Exception {
            User u = owner("9866600111");
            Property p = listing(u);
            boost(u, p, 201);

            assertThat(boostService.expireAbandonedCheckouts(past())).isZero();

            assertThat(statusOfLatestBoost(p)).isEqualTo(BoostStatuses.PENDING);
        }

        @Test
        @DisplayName("an active boost is never touched, however old it is")
        void paidBoostsAreUntouchable() throws Exception {
            User u = owner("9866600112");
            Property p = listing(u);
            deliverSigned(boostAndReadRef(u, p));

            assertThat(boostService.expireAbandonedCheckouts(future())).isZero();

            assertThat(statusOfLatestBoost(p)).isEqualTo(BoostStatuses.ACTIVE);
        }

        @Test
        @DisplayName("a second pass over the same rows expires nothing further")
        void theSweepIsIdempotent() throws Exception {
            User u = owner("9866600113");
            boost(u, listing(u), 201);

            assertThat(boostService.expireAbandonedCheckouts(future())).isEqualTo(1);
            assertThat(boostService.expireAbandonedCheckouts(future())).isZero();
        }

        /** An expiry that wrote {@code boosted_until} anyway would rank a listing nobody paid for. */
        @Test
        @DisplayName("expiring an unpaid boost does not touch the listing's ranking")
        void theListingIsNotPromoted() throws Exception {
            User u = owner("9866600114");
            Property p = listing(u);
            boost(u, p, 201);

            boostService.expireAbandonedCheckouts(future());

            assertThat(isPromoted(p)).isFalse();
        }
    }

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Sweep User " + mobile.substring(6));
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

    /** Everything this suite creates is younger than this, so the whole set is past its TTL. */
    private Instant future() {
        return Instant.now().plus(Duration.ofMinutes(5));
    }

    /** Older than anything this suite creates, so nothing is stale. */
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

    private String statusOfLatestBoost(Property listing) {
        return boosts.findByPropertyIdOrderByCreatedAtDesc(listing.getId())
                .getFirst().getStatus();
    }

    /** Same reasoning: flush first, or the ranking column is read as it was before the sweep. */
    private boolean isPromoted(Property listing) {
        return properties.findById(listing.getId()).orElseThrow().getBoostedUntil() != null;
    }

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }
}
