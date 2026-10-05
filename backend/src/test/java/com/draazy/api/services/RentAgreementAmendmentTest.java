package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.lessThan;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import com.draazy.api.services.request.ServiceRequestAmendmentRepository;
import com.jayway.jsonpath.JsonPath;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

// Re-priced terms reach the draft only once the requester accepted them and paid any difference.
@DisplayName("Rent agreement amendments — the desk proposes, the requester accepts and pays the difference")
class RentAgreementAmendmentTest extends ServiceFixtures {

    private static final String TERMS = "{\"type\":\"rent-agreement\",\"details\":{\"rent\":20000,"
            + "\"deposit\":60000,\"months\":11,\"_state\":{\"terms\":{\"rent\":\"20000\",\"deposit\":\"60000\","
            + "\"months\":\"11\"}}}}";

    @Autowired
    ServiceRequestAmendmentRepository amendmentRepo;
    @Autowired
    EntityManager em;

    private String raiseWithTerms(User owner) throws Exception {
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content(TERMS))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = field(json, "id");
        serviceRequests.applyWebhookOutcome(paymentRef(id), true, 0);
        return id;
    }

    private ResultActions propose(User caller, String id, String body) throws Exception {
        return mvc.perform(post(Routes.ServiceRequests.AMENDMENTS, id)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions accept(User caller, String id, String amendmentId) throws Exception {
        return mvc.perform(post(Routes.ServiceRequests.AMENDMENT_ACCEPT, id, amendmentId)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller)));
    }

    private ResultActions read(User caller, String id) throws Exception {
        em.flush();
        em.clear();
        return mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))).andExpect(status().isOk());
    }

    private String openAmendment(String id) {
        return amendmentRepo.findByServiceRequestIdAndStatus(UUID.fromString(id), "proposed")
                .orElseThrow().getId().toString();
    }

    private String orderOf(String amendmentId) {
        em.flush();
        return amendmentRepo.findById(UUID.fromString(amendmentId)).orElseThrow().getPaymentRef();
    }

    @Test
    @DisplayName("a higher rent is paid for before the draft is shared, and a failed payment can be retried")
    void higherTermsArePaidBeforeTheDraft() throws Exception {
        User owner = customer("9820008001");
        User desk = staff("9820008002", Teams.RENTAL);
        User stranger = customer("9820008003");
        String id = raiseWithTerms(owner);
        setStatus(desk, id, "assigned", 200);
        long paid = requestRepo.findById(UUID.fromString(id)).orElseThrow().getAmount();

        propose(owner, id, "{\"rent\":25000,\"reason\":\"Owner agreed 25k\"}").andExpect(status().isForbidden());
        propose(desk, id, "{\"rent\":25000,\"reason\":\"Owner and tenant agreed ₹25,000 on the call\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amendment.amountBefore").value(paid))
                .andExpect(jsonPath("$.amendment.delta", greaterThan(0)))
                .andExpect(jsonPath("$.amendment.terms.rent").value(25000))
                .andExpect(jsonPath("$.amendment.checkoutOpen").value(false))
                .andExpect(jsonPath("$.details.rent").value(20000));
        String amendment = openAmendment(id);
        propose(desk, id, "{\"rent\":26000,\"reason\":\"Second thoughts\"}").andExpect(status().isConflict());
        shareDraft(desk, id, 409);

        accept(stranger, id, amendment).andExpect(status().isNotFound());
        accept(desk, id, amendment).andExpect(status().isForbidden());
        accept(owner, id, amendment)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paymentSessionId", notNullValue()))
                .andExpect(jsonPath("$.amendment.checkoutOpen").value(true));
        String firstOrder = orderOf(amendment);
        accept(owner, id, amendment).andExpect(jsonPath("$.paymentSessionId", notNullValue()));
        assertThat(orderOf(amendment)).isEqualTo(firstOrder);

        deliverSigned(firstOrder, false);
        read(owner, id).andExpect(jsonPath("$.amendment.checkoutOpen").value(false))
                .andExpect(jsonPath("$.details.rent").value(20000));

        accept(owner, id, amendment).andExpect(status().isOk());
        String secondOrder = orderOf(amendment);
        deliverSigned(secondOrder, true);
        long after = amendmentRepo.findById(UUID.fromString(amendment)).orElseThrow().getAmountAfter();
        read(owner, id)
                .andExpect(jsonPath("$.amendment").value(nullValue()))
                .andExpect(jsonPath("$.details.rent").value(25000))
                .andExpect(jsonPath("$.details._state.terms.rent").value("25000"))
                .andExpect(jsonPath("$.amount").value(after));
        deliverSigned(secondOrder, true);
        read(owner, id).andExpect(jsonPath("$.amount").value(after));
        shareDraft(desk, id, 200);
        propose(desk, id, "{\"rent\":27000,\"reason\":\"After the draft\"}").andExpect(status().isConflict());
    }

    @Test
    @DisplayName("the desk corrects the registration area from the Index II, and the fee moves by ₹500 (D-h)")
    void deskCorrectsTheRegistrationArea() throws Exception {
        User owner = customer("9820008021");
        User desk = staff("9820008022", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(desk, id, "assigned", 200);
        read(owner, id).andExpect(jsonPath("$.details.regArea").value("Municipal / Urban"));

        propose(desk, id, "{\"regArea\":\"urban\",\"reason\":\"Already municipal\"}")
                .andExpect(status().isUnprocessableEntity());
        propose(desk, id, "{\"regArea\":\"rural\",\"reason\":\"Index II: Gram Panchayat Maan\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amendment.delta").value(-500))
                .andExpect(jsonPath("$.amendment.terms.regArea").value("Rural"));
        accept(owner, id, openAmendment(id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.details.regArea").value("Rural"));
    }

    @Test
    @DisplayName("a lower rent applies on acceptance with nothing to pay, and the overpayment stays on the record")
    void lowerTermsApplyOnAcceptance() throws Exception {
        User owner = customer("9820008011");
        User desk = staff("9820008012", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(desk, id, "assigned", 200);
        long paid = requestRepo.findById(UUID.fromString(id)).orElseThrow().getAmount();

        propose(desk, id, "{\"rent\":15000,\"months\":12,\"reason\":\"Rent negotiated down\"}")
                .andExpect(jsonPath("$.amendment.delta", lessThan(0)));
        accept(owner, id, openAmendment(id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paymentSessionId").value(nullValue()))
                .andExpect(jsonPath("$.amendment").value(nullValue()))
                .andExpect(jsonPath("$.details.rent").value(15000))
                .andExpect(jsonPath("$.details.months").value(12))
                .andExpect(jsonPath("$.amount").value(paid));
    }

    @Test
    @DisplayName("an admin fee change after payment is not billed again when the terms are amended")
    void amendmentsRepriceOnlyTheStatutoryLines() throws Exception {
        User desk = staff("9820008022", Teams.RENTAL);
        String before = raiseWithTerms(customer("9820008021"));
        String after = raiseWithTerms(customer("9820008023"));
        setStatus(desk, before, "assigned", 200);
        setStatus(desk, after, "assigned", 200);
        String change = "{\"rent\":25000,\"reason\":\"Owner agreed\"}";
        Number delta = JsonPath.read(propose(desk, before, change).andReturn().getResponse().getContentAsString(),
                "$.amendment.delta");

        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin("9820008024")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fees\":{\"rentAgreementPlatform\":1500}}"))
                .andExpect(status().isOk());

        propose(desk, after, change).andExpect(jsonPath("$.amendment.delta").value(delta.longValue()));
    }

    @Test
    @DisplayName("unchanged or unpriceable terms are refused, and withdrawn terms free the draft")
    void refusalsAndWithdrawal() throws Exception {
        User owner = customer("9820008021");
        User desk = staff("9820008022", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        propose(desk, id, "{\"rent\":25000,\"reason\":\"Not taken yet\"}").andExpect(status().isConflict());
        setStatus(desk, id, "assigned", 200);

        propose(desk, id, "{\"rent\":20000,\"reason\":\"Same rent\"}").andExpect(status().isUnprocessableEntity());
        propose(desk, id, "{\"reason\":\"Nothing named\"}").andExpect(status().isUnprocessableEntity());
        propose(desk, id, "{\"months\":61,\"reason\":\"Too long\"}").andExpect(status().isUnprocessableEntity());
        propose(desk, id, "{\"rent\":25000}").andExpect(status().isUnprocessableEntity());

        propose(desk, id, "{\"rent\":25000,\"reason\":\"Owner agreed\"}").andExpect(status().isCreated());
        String amendment = openAmendment(id);
        accept(owner, id, amendment).andExpect(status().isOk());
        String order = orderOf(amendment);
        mvc.perform(post(Routes.ServiceRequests.AMENDMENT_WITHDRAW, id, amendment)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.amendment").value(nullValue()));
        accept(owner, id, amendment).andExpect(status().isNotFound());
        deliverSigned(order, true);
        read(owner, id).andExpect(jsonPath("$.details.rent").value(20000));
        shareDraft(desk, id, 200);
    }
}
