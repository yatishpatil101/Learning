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

// The statutory half of the bill is computed from the customer's own terms, never read as a flat published figure.
@DisplayName("Rent agreement pricing — the statutory charges are computed, not published")
class ServiceRequestRentPricingTest extends ServiceFixtures {

    // The seeded admin fee (₹500) plus 18% GST.
    private static final int PLATFORM_HALF = 590;

    @Test
    @DisplayName("the published rent schedule states no flat stamp duty or registration")
    void statutoryLinesAreNotPublished() throws Exception {

        mvc.perform(get("/fees"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[1].deal").value("rent"))
                .andExpect(jsonPath("$[1].platformFee").value(500))
                .andExpect(jsonPath("$[1].gst").value(90))
                .andExpect(jsonPath("$[1].stampDuty").doesNotExist())
                .andExpect(jsonPath("$[1].registration").doesNotExist());
    }

    // The non-refundable deposit lives only in the wizard's `_state` snapshot, so a pricer reading the top level
    // alone would undercharge.
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
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1000 + 1000 + 300));
    }

    // It is not: a statutory figure derived from a rent nobody stated is a wrong number wearing the clothes of a
    // right one, and ops cannot draw the agreement from this request either.
    @Test
    @DisplayName("a customer who says Rural in a municipal locality is still charged ₹1,000")
    void customerCannotChooseTheCheaperFee() throws Exception {
        User buyer = customer("9820000902");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(located(p, "false", "Rural")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1000 + 1000 + 300))
                .andExpect(jsonPath("$.details.regArea").value("Municipal / Urban"))
                .andExpect(jsonPath("$.details._state.regArea").value("urban"));
    }

    /** A blank term is eleven months — the wizard's own default, so the two cannot diverge. */
    @Test
    @DisplayName("a property the customer says is under a gram panchayat is charged ₹500, whatever regArea says")
    void gramPanchayatAnswerIsRural() throws Exception {
        User buyer = customer("9820000911");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(located(p, "true", "Municipal / Urban")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1000 + 500 + 300))
                .andExpect(jsonPath("$.details.regArea").value("Rural"))
                .andExpect(jsonPath("$.details._state.regArea").value("rural"));
    }

    @Test
    @DisplayName("a stated rent with no gram panchayat answer is a 422, not a guessed fee")
    void missingGramPanchayatAnswerIsRefused() throws Exception {
        User buyer = customer("9820000913");
        Property p = listing(buyer);
        String body = "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":32000,\"deposit\":150000,\"months\":\"11\","
                + "\"_state\":{\"prop\":{\"locality\":\"Baner\"}}}}";

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("under a gram panchayat")));
    }

    @Test
    @DisplayName("a gram panchayat answer that is not a boolean is a 422")
    void nonBooleanGramPanchayatAnswerIsRefused() throws Exception {
        User buyer = customer("9820000914");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(located(p, "\"yes\"", "Municipal / Urban")))
                .andExpect(status().isUnprocessableEntity());
    }

    // Silently clamping it to the ceiling would bill a number the customer never asked for.
    @Test
    @DisplayName("a rural area smuggled into the terms snapshot is ignored")
    void termsSnapshotCannotChooseTheFee() throws Exception {
        User buyer = customer("9820000912");
        Property p = listing(buyer);
        String body = "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":32000,\"deposit\":150000,\"months\":\"11\","
                + "\"_state\":{\"prop\":{\"gramPanchayat\":false},\"terms\":{\"regArea\":\"Rural\"}}}}";

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1000 + 1000 + 300));
    }

    @Test
    @DisplayName("the non-refundable deposit is found in the wizard's _state snapshot")
    void readsNonRefundableDepositFromState() throws Exception {
        User buyer = customer("9820000903");
        Property p = listing(buyer);
        String body = "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":32000,\"deposit\":150000,\"months\":\"11\","
                + "\"regArea\":\"Municipal / Urban\","
                + "\"_state\":{\"prop\":{\"gramPanchayat\":false},\"terms\":{\"nrDeposit\":\"50000\"}}}}";

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1100 + 1000 + 300));
    }

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
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1000 + 1000 + 300));
    }

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

    @Test
    @DisplayName("a 61-month rent agreement is refused before pricing")
    void termPastArticle36ACeilingIsRefused() throws Exception {
        User buyer = customer("9820000907");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                                + "\"details\":{\"rent\":32000,\"months\":61,"
                                + "\"_state\":{\"prop\":{\"gramPanchayat\":false},\"terms\":{\"months\":\"61\"}}}}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("the rent escalation stated in _state is taxed")
    void taxesTheEscalatedRent() throws Exception {
        User buyer = customer("9820000908");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(escalated(p, "\"increment\":\"5\",\"incrementEvery\":\"12\"")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1200 + 1000 + 300));
    }

    @Test
    @DisplayName("an escalation with no stated interval runs every eleven months")
    void blankIntervalFallsBackToEleven() throws Exception {
        User buyer = customer("9820000909");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(escalated(p, "\"increment\":\"5\"")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(PLATFORM_HALF + 1200 + 1000 + 300));
    }

    @Test
    @DisplayName("an escalation interval other than 11 or 12 months is a 422")
    void implausibleIntervalIsRefused() throws Exception {
        User buyer = customer("9820000910");
        Property p = listing(buyer);

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(escalated(p, "\"increment\":\"5\",\"incrementEvery\":\"6\"")))
                .andExpect(status().isUnprocessableEntity());
    }

    private static String escalated(Property p, String escalation) {
        return "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":20000,\"deposit\":100000,\"months\":\"22\","
                + "\"regArea\":\"Municipal / Urban\","
                + "\"_state\":{\"prop\":{\"gramPanchayat\":false},\"terms\":{\"months\":\"22\"," + escalation + "}}}}";
    }

    private static String located(Property p, String gramPanchayatJson, String regArea) {
        return "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":32000,\"deposit\":150000,\"months\":\"11\",\"regArea\":\""
                + regArea + "\",\"_state\":{\"prop\":{\"gramPanchayat\":" + gramPanchayatJson + "}}}}";
    }

    private static String terms(Property p, long rent, long deposit, String months, String regArea) {
        return "{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\","
                + "\"details\":{\"rent\":" + rent + ",\"deposit\":" + deposit
                + ",\"months\":\"" + months + "\",\"regArea\":\"" + regArea + "\","
                + "\"_state\":{\"prop\":{\"gramPanchayat\":false}}}}";
    }
}
