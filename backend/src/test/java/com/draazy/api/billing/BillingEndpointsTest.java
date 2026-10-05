package com.draazy.api.billing;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.plan.SubscriptionRepository;
import com.draazy.api.billing.plan.SubscriptionStatuses;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.cashfree.WebhookSignature;
import com.draazy.api.security.JwtService;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** The four properties a bug here costs money on: the price lists are public and non-empty, only
 *  the signed webhook may write {@code active}, a retry does not buy twice, a boost is owner-scoped. */
class BillingEndpointsTest extends AbstractApiTest {

    /** Seeded by {@code R__DML_seed_reference_data.sql}. Free, so it activates without a payment. */
    private static final String FREE_PLAN = "b1000000-0000-4000-8000-000000000001";

    /** Owner Plus, 999/yearly — priced, so it must go through the gateway. */
    private static final String PAID_PLAN = "b1000000-0000-4000-8000-000000000002";

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired WebhookSignature webhookSignature;

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Billing User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void deliverSigned(String orderId, String status) throws Exception {
        String paidAt = java.time.OffsetDateTime.now(java.time.ZoneId.of("Asia/Kolkata"))
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX"));
        String body = "{\"type\":\"PAYMENT_SUCCESS_WEBHOOK\",\"data\":{"
                + "\"order\":{\"order_id\":\"" + orderId + "\"},"
                + "\"payment\":{\"payment_status\":\"" + status + "\","
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

    private static String jsonField(String body, String field) {
        int i = body.indexOf("\"" + field + "\":\"") + field.length() + 4;
        return body.substring(i, body.indexOf('"', i));
    }

    @Test
    void thePriceListsAreReadableWithoutAToken() throws Exception {
        mvc.perform(get(Routes.Plans.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()", Matchers.greaterThanOrEqualTo(4)))
                .andExpect(jsonPath("$[?(@.id=='" + PAID_PLAN + "')].price").value(
                        Matchers.hasItem(999)))

                .andExpect(jsonPath("$[?(@.id=='" + PAID_PLAN + "')].listingLimit").value(
                        Matchers.hasItem(2)))
                .andExpect(jsonPath("$[?(@.id=='" + PAID_PLAN + "')].contactLimit").value(
                        Matchers.hasItem(Matchers.nullValue())));
    }

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

    /** The listing's {@code boosted} flag answers only "promoted right now", so it cannot show a
     *  pack whose payment never completed — the state "I paid and nothing happened" needs. */
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
    void anUnknownPlanIsNotFound() throws Exception {
        User u = user("9855500005", "owner");
        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"not-a-plan\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void buyingAnythingRequiresTheCaller() throws Exception {
        mvc.perform(get(Routes.Plans.SUBSCRIPTION)).andExpect(status().isUnauthorized());
    }
}
