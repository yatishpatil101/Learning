package com.draazy.api.services;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * What a rent agreement is charged, and where each rupee of it comes from (D163).
 *
 * <p>The invariant under test is that <strong>the statutory half of the bill is computed from the
 * customer's own terms, and is never invented</strong>. Before this, {@code platform_fees('rent')}
 * seeded {@code stamp_duty = 0} and {@code registration = 0}, so the platform billed
 * {@code 1999 + 0 + 0 + GST} for a document that legally attracts Art. 36A duty and a registration
 * fee — a gap it would have had to remit out of margin on every single agreement.
 *
 * <p>Separate from {@code ServiceRequestFlowTest} deliberately: that suite is about the
 * maker-checker workflow and raises requests with no terms at all, which is exactly the case this
 * one has to prove behaves <em>differently</em>.
 */
@DisplayName("Rent agreement pricing — the statutory charges are computed, not published")
class ServiceRequestRentPricingTest extends ServiceFixtures {

    /** Platform fee (1999) + GST on it (360). Everything else on the bill belongs to the state. */
    private static final int PLATFORM_HALF = 2359;

    @Test
    @DisplayName("the published rent schedule states no flat stamp duty or registration")
    void statutoryLinesAreNotPublished() throws Exception {
        // Not zero — absent. Zero is a price, and there is no price: the duty is a percentage of a
        // consideration this table has no way to know. The wizard reads the same absence and falls
        // back to the identical formula, which is what keeps the sidebar and the bill in step (D150).
        mvc.perform(get("/fees"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[1].deal").value("rent"))
                .andExpect(jsonPath("$[1].platformFee").value(1999))
                .andExpect(jsonPath("$[1].gst").value(360))
                .andExpect(jsonPath("$[1].stampDuty").doesNotExist())
                .andExpect(jsonPath("$[1].registration").doesNotExist());
    }

    /**
     * The canonical Pune tenancy, priced end to end.
     *
     * <p>₹32,000 × 11 months on a ₹1.5 lakh deposit ⇒ consideration ₹3,67,000, duty ₹918, municipal
     * registration ₹1,000. With the platform's own ₹2,359 that is ₹4,277 — against ₹2,359 before
     * this change, which is the ₹1,918 the platform was quietly absorbing.
     */
    @Test
    @DisplayName("a request that states its terms is charged the real Art. 36A duty")
    void pricesFromTheStatedTerms() throws Exception {
        User buyer = customer("9820000901");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(terms(p, 32_000, 150_000, "11", "Municipal / Urban")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("awaiting-payment"))
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 918 + 1000));
    }

    /** The registering body moves the registration fee and nothing else. */
    @Test
    @DisplayName("a rural registering body is charged ₹500, not ₹1,000")
    void ruralRegistrationIsCheaper() throws Exception {
        User buyer = customer("9820000902");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(terms(p, 32_000, 150_000, "11", "Rural")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 918 + 500));
    }

    /**
     * The non-refundable deposit lives only in the wizard's {@code _state} snapshot — the flattened
     * copy omits it — so a pricer that read the top level alone would undercharge every agreement
     * that has one. ₹50,000 non-refundable adds ₹125 of duty.
     */
    @Test
    @DisplayName("the non-refundable deposit is found in the wizard's _state snapshot")
    void readsNonRefundableDepositFromState() throws Exception {
        User buyer = customer("9820000903");
        Property p = listing(buyer);
        String body = "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":32000,\"deposit\":150000,\"months\":\"11\","
                + "\"regArea\":\"Municipal / Urban\","
                + "\"_state\":{\"terms\":{\"nrDeposit\":\"50000\"}}}}";

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1043 + 1000));
    }

    /**
     * A request with no terms is not taxed at all, and that is the point.
     *
     * <p>It would be trivial to treat the absent rent as zero and bill ₹0 of duty plus a registration
     * fee, and it would look like the system working. It is not: a statutory figure derived from a
     * rent nobody stated is a wrong number wearing the clothes of a right one, and ops cannot draw
     * the agreement from this request either. Absent beats wrong, so the bill stays at the platform's
     * own half — exactly what it was before D163.
     */
    @Test
    @DisplayName("a request with no terms is charged nothing statutory rather than a made-up figure")
    void statesNoTermsSoNothingIsInvented() throws Exception {
        User buyer = customer("9820000904");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF));
    }

    /** A blank term is eleven months — the wizard's own default, so the two cannot diverge. */
    @Test
    @DisplayName("a stated rent with a blank term is priced at eleven months")
    void blankTermFallsBackToEleven() throws Exception {
        User buyer = customer("9820000905");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(terms(p, 32_000, 150_000, "", "Municipal / Urban")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 918 + 1000));
    }

    /**
     * Stated but unpriceable is a different thing from unstated: it is a malformed body, and a body
     * validation failure is a 422. Silently clamping it to the ceiling would bill a number the
     * customer never asked for.
     */
    @Test
    @DisplayName("a rent outside the priceable range is a 422, not a clamped bill")
    void implausibleRentIsRefused() throws Exception {
        User buyer = customer("9820000906");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(terms(p, 2_000_000_000, 0, "11", "Municipal / Urban")))
                .andExpect(status().isUnprocessableEntity());
    }

    /** The flattened terms the wizard posts alongside its {@code _state} snapshot. */
    private static String terms(Property p, long rent, long deposit, String months, String regArea) {
        return "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":" + rent + ",\"deposit\":" + deposit
                + ",\"months\":\"" + months + "\",\"regArea\":\"" + regArea + "\"}}";
    }
}
