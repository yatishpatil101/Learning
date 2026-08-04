package com.punenest.api.billing;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.provider.cashfree.WebhookSignature;
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Contract + behaviour proof for the monetisation surface (slice 13): plans, subscriptions, listing
 * boosts and the services marketplace.
 *
 * <p>Four properties are worth proving here, and they are the four a bug would cost money on:
 *
 * <ol>
 *   <li><strong>The price lists are public and are not empty.</strong> All three declare
 *       {@code security: []}, and all three were unseeded before this slice — a catalogue endpoint
 *       that answers {@code 200 []} looks healthy from every angle except the customer's.</li>
 *   <li><strong>Nothing on the controller can write {@code active}.</strong> A priced purchase is
 *       created {@code pending} against a gateway order; only the signature-verified webhook may
 *       activate it. A free one is active immediately because there is no money to wait for.</li>
 *   <li><strong>A retry does not buy twice.</strong> {@code Idempotency-Key} replays the original
 *       row on all three purchase endpoints.</li>
 *   <li><strong>A boost is scoped to the caller's own listing.</strong> Someone else's is a 404,
 *       never a 403 — a 403 would confirm the listing exists.</li>
 * </ol>
 */
class BillingEndpointsTest extends AbstractApiTest {

    /** Seeded by {@code R__seed_reference_data.sql}. Free, so it activates without a payment. */
    private static final String FREE_PLAN = "b1000000-0000-4000-8000-000000000001";

    /** Owner Plus, 2499/yearly — priced, so it must go through the gateway. */
    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    /** 7-day Spotlight, 999. */
    private static final String BOOST_PACK = "b2000000-0000-4000-8000-000000000001";

    /** Packers &amp; Movers. */
    private static final String OFFERING = "b3000000-0000-4000-8000-000000000001";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired BoostRepository boosts;
    @Autowired WebhookSignature webhookSignature;

    // ---- fixtures ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Billing User " + mobile.substring(6));
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

    /** The nested payload Cashfree actually sends (spec fix S15), signed with the real HMAC. */
    private void deliverSigned(String orderId, String status) throws Exception {
        String body = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"" + status + "\","
                + "\"payment_amount\":2499.00,"
                + "\"payment_time\":\"2025-03-05T11:20:00+05:30\"}}}";
        String ts = String.valueOf(System.currentTimeMillis());
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .header("x-webhook-timestamp", ts)
                        .header("x-webhook-signature", webhookSignature.sign(ts, body))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }

    // ---- 1: the price lists are public, and they have prices in them ----

    @Test
    void thePriceListsAreReadableWithoutAToken() throws Exception {
        mvc.perform(get(Routes.Plans.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()", Matchers.greaterThanOrEqualTo(4)))
                .andExpect(jsonPath("$[?(@.id=='" + PAID_PLAN + "')].price").value(
                        Matchers.hasItem(2499)));

        mvc.perform(get(Routes.Boosts.PACKS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()", Matchers.greaterThanOrEqualTo(3)))
                .andExpect(jsonPath("$[0].placement").value("top"));

        mvc.perform(get(Routes.ServiceCatalog.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()", Matchers.greaterThanOrEqualTo(6)));
    }

    // ---- 2: a subscription is pending until the money moves ----

    @Test
    void aFreePlanIsActiveImmediatelyAndCarriesNoPaymentRef() throws Exception {
        User u = user("9855500001", "owner");

        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + FREE_PLAN + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.ACTIVE))
                .andExpect(jsonPath("$.paymentRef").value(Matchers.nullValue()))
                .andExpect(jsonPath("$.renewsAt").value(Matchers.notNullValue()));
    }

    @Test
    void aPricedPlanIsPendingUntilTheWebhookConfirms() throws Exception {
        User u = user("9855500002", "owner");

        String created = mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + PAID_PLAN + "\",\"paymentMethod\":\"upi\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.PENDING))
                .andExpect(jsonPath("$.paymentRef").value(Matchers.notNullValue()))
                .andExpect(jsonPath("$.renewsAt").value(Matchers.nullValue()))
                .andReturn().getResponse().getContentAsString();

        // With nothing else held, the pending order is still reported so the checkout can be
        // resumed — but it is reported as pending, never as an entitlement.
        mvc.perform(get(Routes.Plans.SUBSCRIPTION).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.PENDING))
                .andExpect(jsonPath("$.renewsAt").value(Matchers.nullValue()));

        String orderId = jsonField(created, "paymentRef");
        deliverSigned(orderId, "SUCCESS");

        mvc.perform(get(Routes.Plans.SUBSCRIPTION).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(PAID_PLAN))
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.ACTIVE))
                .andExpect(jsonPath("$.renewsAt").value(Matchers.notNullValue()));

        // A redelivery of the same event must not move it again or extend the term.
        var renewsAt = subscriptions.findByPaymentRef(orderId).orElseThrow().getRenewsAt();
        deliverSigned(orderId, "SUCCESS");
        assertThat(subscriptions.findByPaymentRef(orderId).orElseThrow().getRenewsAt())
                .isEqualTo(renewsAt);
    }

    @Test
    void anAbandonedUpgradeDoesNotCancelThePlanAlreadyHeld() throws Exception {
        User u = user("9855500003", "owner");
        String auth = bearer(u);

        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + FREE_PLAN + "\"}"))
                .andExpect(status().isCreated());

        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + PAID_PLAN + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.PENDING));

        mvc.perform(get(Routes.Plans.SUBSCRIPTION).header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.planId").value(FREE_PLAN))
                .andExpect(jsonPath("$.status").value(SubscriptionStatuses.ACTIVE));
    }

    @Test
    void subscribingTwiceWithOneIdempotencyKeyBuysOnce() throws Exception {
        User u = user("9855500004", "owner");
        String auth = bearer(u);
        String body = "{\"planId\":\"" + PAID_PLAN + "\"}";

        String first = mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .header("Idempotency-Key", "sub-retry-1")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        String second = mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .header("Idempotency-Key", "sub-retry-1")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        assertThat(jsonField(second, "id")).isEqualTo(jsonField(first, "id"));
        assertThat(subscriptions.findByUserIdOrderByStartedAtDesc(u.getId())).hasSize(1);
    }

    @Test
    void anUnknownPlanIsNotFound() throws Exception {
        User u = user("9855500005", "owner");
        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"not-a-plan\"}"))
                .andExpect(status().isNotFound());
    }

    // ---- 3: boosts ----

    @Test
    void aBoostIsPendingUntilPaidAndThenOpensItsWindow() throws Exception {
        User owner = user("9855500010", "owner");
        Property p = listing(owner);

        String created = mvc.perform(post("/me/properties/" + p.getId() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packId\":\"" + BOOST_PACK + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(BoostStatuses.PENDING))
                .andExpect(jsonPath("$.startsAt").value(Matchers.nullValue()))
                .andExpect(jsonPath("$.paymentRef").value(Matchers.notNullValue()))
                .andReturn().getResponse().getContentAsString();

        String orderId = jsonField(created, "paymentRef");
        deliverSigned(orderId, "SUCCESS");

        var boost = boosts.findByPaymentRef(orderId).orElseThrow();
        assertThat(boost.getStatus()).isEqualTo(BoostStatuses.ACTIVE);
        assertThat(boost.getStartsAt()).isNotNull();
        assertThat(boost.getEndsAt()).isAfter(boost.getStartsAt());
    }

    /**
     * {@code GET /me/properties/{propId}/boost} — the read the boost surface shipped without.
     *
     * <p>Buying a window was a write with no corresponding read anywhere: no boost list, and no
     * {@code boosted} flag on the listing either (deliberately — a boost does not yet affect
     * ranking, tech-debt D59). So an owner who had paid could not be shown what they had paid for,
     * and the state was only observable by querying the database.
     */
    @Test
    void anOwnerCanReadTheBoostsTheyBought() throws Exception {
        User owner = user("9855500014", "owner");
        Property p = listing(owner);

        mvc.perform(get("/me/properties/" + p.getId() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        mvc.perform(post("/me/properties/" + p.getId() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packId\":\"" + BOOST_PACK + "\"}"))
                .andExpect(status().isCreated());

        // Reported while still pending, deliberately: a boost that never left `pending` is a
        // payment that did not complete, and that is precisely what an owner asking "I paid and
        // nothing happened" needs to see. Filtering to active windows would hide it.
        mvc.perform(get("/me/properties/" + p.getId() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value(BoostStatuses.PENDING))
                .andExpect(jsonPath("$[0].packId").value(BOOST_PACK));
    }

    /** Same owner-scoping as the write: another owner's boost history is a 404, not a 403. */
    @Test
    void aStrangerCannotReadAnothersBoosts() throws Exception {
        User owner = user("9855500015", "owner");
        User stranger = user("9855500016", "owner");
        Property p = listing(owner);

        mvc.perform(get("/me/properties/" + p.getId() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    @Test
    void aFailedPaymentDoesNotOpenTheBoostWindow() throws Exception {
        User owner = user("9855500011", "owner");
        Property p = listing(owner);

        String created = mvc.perform(post("/me/properties/" + p.getId() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"packId\":\"" + BOOST_PACK + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        String orderId = jsonField(created, "paymentRef");
        deliverSigned(orderId, "FAILED");

        var boost = boosts.findByPaymentRef(orderId).orElseThrow();
        assertThat(boost.getStatus()).isNotEqualTo(BoostStatuses.ACTIVE);
        assertThat(boost.getStartsAt()).isNull();
    }

    @Test
    void aStrangersListingCannotBeBoosted() throws Exception {
        User owner = user("9855500012", "owner");
        User stranger = user("9855500013", "owner");
        Property p = listing(owner);
        String body = "{\"packId\":\"" + BOOST_PACK + "\"}";

        mvc.perform(post("/me/properties/" + p.getId() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());

        mvc.perform(post("/me/properties/" + java.util.UUID.randomUUID() + "/boost")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNotFound());
    }

    // ---- 4: the services marketplace ----

    @Test
    void anOrderIsPlacedWithoutAnAmountAndReadBackByItsOwner() throws Exception {
        User u = user("9855500020", "buyer");
        String auth = bearer(u);
        String body = "{\"offeringId\":\"" + OFFERING + "\",\"notes\":\"3rd floor\"}";

        mvc.perform(post(Routes.ServiceCatalog.ORDERS)
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .header("Idempotency-Key", "order-retry-1")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                // The customer never names the price, and the catalogue's "from" figure is not one.
                .andExpect(jsonPath("$.amount").value(Matchers.nullValue()))
                .andExpect(jsonPath("$.offeringId").value(OFFERING));

        mvc.perform(post(Routes.ServiceCatalog.ORDERS)
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .header("Idempotency-Key", "order-retry-1")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());

        mvc.perform(get(Routes.ServiceCatalog.ORDERS).header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        User other = user("9855500021", "buyer");
        mvc.perform(get(Routes.ServiceCatalog.ORDERS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void anOrderCannotNameSomeoneElsesListing() throws Exception {
        User owner = user("9855500022", "owner");
        User stranger = user("9855500023", "buyer");
        Property p = listing(owner);

        mvc.perform(post(Routes.ServiceCatalog.ORDERS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offeringId\":\"" + OFFERING + "\",\"propertyId\":\""
                                + p.getId() + "\"}"))
                .andExpect(status().isNotFound());
    }

    // ---- 5: none of the purchase endpoints is anonymous ----

    @Test
    void buyingAnythingRequiresTheCaller() throws Exception {
        mvc.perform(get(Routes.Plans.SUBSCRIPTION)).andExpect(status().isUnauthorized());
        mvc.perform(get(Routes.ServiceCatalog.ORDERS)).andExpect(status().isUnauthorized());
    }
}
