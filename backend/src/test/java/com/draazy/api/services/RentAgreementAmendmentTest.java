package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.lessThan;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.doReturn;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.provider.PaymentGateway;
import com.draazy.api.security.Teams;
import com.draazy.api.services.request.ServiceRequestAmendmentRepository;
import com.jayway.jsonpath.JsonPath;
import jakarta.persistence.EntityManager;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.ResultActions;

// Re-priced terms reach the draft only once the requester accepted them and paid any difference.
@DisplayName("Rent agreement amendments — the desk proposes, the requester accepts and pays the difference")
class RentAgreementAmendmentTest extends ServiceFixtures {

    private static final String TERMS = "{\"type\":\"rent-agreement\",\"details\":{\"rent\":20000,"
            + "\"deposit\":60000,\"months\":11,\"_state\":{\"prop\":{\"gramPanchayat\":false},\"terms\":{\"rent\":\"20000\",\"deposit\":\"60000\","
            + "\"months\":\"11\"}}}}";

    @Autowired
    ServiceRequestAmendmentRepository amendmentRepo;
    @Autowired
    EntityManager em;
    @MockitoSpyBean
    PaymentGateway gateway;

    private void refund(User maker, User checker, String id, long amount) throws Exception {
        String json = mvc.perform(post(Routes.ServiceRequests.REFUNDS, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(maker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amount\":" + amount + ",\"dutyPaid\":false,\"reason\":\"Goodwill credit\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        mvc.perform(post(Routes.ServiceRequests.REFUND_APPROVE, id, JsonPath.<String>read(json, "$.refunds[0].id"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"Checked\"}"))
                .andExpect(status().isOk());
    }

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

    private Map<String, Object> notice(User user, String type) {
        em.flush();
        return jdbc.queryForMap("select title, body, link from notifications where user_id = ? and type = ?",
                user.getId(), type);
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
        assertThat(notice(owner, "service.amendment-proposed"))
                .containsEntry("title", "Revised terms to accept")
                .hasEntrySatisfying("body", b -> assertThat((String) b).matches("The new terms add \u20b9[\\d,]+ of charges\\..*"));
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
        assertThat(notice(owner, "service.amendment-proposed"))
                .containsEntry("body", "Accept the new terms so our team can revise your draft.");
        assertThat(notice(desk, "service.amendment-applied"))
                .containsEntry("title", "Revised terms accepted")
                .containsEntry("link", "/ops/drafting-desk");
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
    @DisplayName("a later amendment is priced against what is still paid, not the gross amount")
    void amendmentsPriceAgainstNetPaid() throws Exception {
        User desk = staff("9820008032", Teams.RENTAL);
        User checker = staff("9820008033", Teams.RENTAL);
        String refunded = raiseWithTerms(customer("9820008031"));
        String untouched = raiseWithTerms(customer("9820008034"));
        setStatus(desk, refunded, "assigned", 200);
        setStatus(desk, untouched, "assigned", 200);
        long paid = requestRepo.findById(UUID.fromString(refunded)).orElseThrow().getAmount();
        refund(desk, checker, refunded, 500);
        String change = "{\"rent\":25000,\"reason\":\"Owner agreed\"}";

        Number delta = JsonPath.read(propose(desk, untouched, change).andReturn().getResponse().getContentAsString(),
                "$.amendment.delta");
        propose(desk, refunded, change).andExpect(status().isCreated())
                .andExpect(jsonPath("$.amendment.amountBefore").value(paid - 500))
                .andExpect(jsonPath("$.amendment.delta").value(delta.longValue()));
    }

    @Test
    @DisplayName("the yearly-increase interval is an amendable term, and only 11 or 12 months is priced")
    void theIncrementIntervalCanBeAmended() throws Exception {
        User owner = customer("9820008041");
        User desk = staff("9820008042", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(desk, id, "assigned", 200);

        propose(desk, id, "{\"months\":24,\"increment\":10,\"incrementEvery\":13,\"reason\":\"Every 13 months\"}")
                .andExpect(status().isUnprocessableEntity());
        propose(desk, id, "{\"months\":24,\"increment\":10,\"incrementEvery\":12,\"reason\":\"Yearly 10% agreed\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amendment.terms.incrementEvery").value(12));
        String amendment = openAmendment(id);
        accept(owner, id, amendment).andExpect(status().isOk());
        String order = orderOf(amendment);
        if (order != null) {
            deliverSigned(order, true);
        }
        read(owner, id).andExpect(jsonPath("$.details._state.terms.incrementEvery").value("12"));
    }

    @Test
    @DisplayName("an accepted co-fill party hears about proposed and applied terms, not only the requester")
    void coFillPartiesAreNotified() throws Exception {
        User owner = customer("9820008051");
        User tenant = customer("9820008052");
        User invited = customer("9820008053");
        User desk = staff("9820008054", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(desk, id, "assigned", 200);
        jdbc.update("insert into service_request_parties (request_id, user_id, role, status, invited_by)"
                + " values (?, ?, 'tenant', 'accepted', ?)", UUID.fromString(id), tenant.getId(), owner.getId());
        jdbc.update("insert into service_request_parties (request_id, user_id, role, status, invited_by, party_index)"
                + " values (?, ?, 'tenant', 'invited', ?, 1)", UUID.fromString(id), invited.getId(), owner.getId());

        propose(desk, id, "{\"rent\":15000,\"months\":12,\"reason\":\"Rent negotiated down\"}").andExpect(status().isCreated());
        assertThat(notice(tenant, "service.amendment-proposed")).containsEntry("title", "Revised terms proposed");
        accept(owner, id, openAmendment(id)).andExpect(status().isOk());

        assertThat(notice(tenant, "service.amendment-applied")).containsEntry("title", "Terms revised");
        assertThat(jdbc.queryForList("select 1 from notifications where user_id = ?", invited.getId())).isEmpty();
    }

    @Test
    @DisplayName("a payment that lands on withdrawn terms becomes a refundable credit instead of a log line")
    void aPaymentOnWithdrawnTermsIsKeptAsCredit() throws Exception {
        User owner = customer("9820008061");
        User desk = staff("9820008062", Teams.RENTAL);
        User checker = staff("9820008063", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(desk, id, "assigned", 200);
        long paid = requestRepo.findById(UUID.fromString(id)).orElseThrow().getAmount();
        propose(desk, id, "{\"rent\":25000,\"reason\":\"Owner agreed\"}").andExpect(status().isCreated());
        String amendment = openAmendment(id);
        accept(owner, id, amendment).andExpect(status().isOk());
        String order = orderOf(amendment);
        long delta = amendmentRepo.findById(UUID.fromString(amendment)).orElseThrow().getAmountAfter() - paid;
        mvc.perform(post(Routes.ServiceRequests.AMENDMENT_WITHDRAW, id, amendment)
                .header(HttpHeaders.AUTHORIZATION, bearer(desk))).andExpect(status().isOk());

        deliverSigned(order, true);
        deliverSigned(order, true);

        read(owner, id).andExpect(jsonPath("$.amount").value(paid + delta))
                .andExpect(jsonPath("$.details.rent").value(20000))
                .andExpect(jsonPath("$.timeline[*].event", hasItem("amendment.payment-unapplied")));
        assertThat(notice(owner, "service.amendment-credit")).containsEntry("title", "Payment received for withdrawn terms");
        assertThat(notice(desk, "service.amendment-credit")).containsEntry("title", "Refund due on a withdrawn amendment");

        refund(desk, checker, id, paid);
        mvc.perform(post(Routes.ServiceRequests.REFUNDS, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amount\":" + delta + ",\"dutyPaid\":false,\"reason\":\"Withdrawn terms\"}"))
                .andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("select order_id from service_request_refunds where service_request_id = ?"
                + " and status = 'requested'", String.class, UUID.fromString(id))).isEqualTo(order);
    }

    @Test
    @DisplayName("an expired checkout is reopened on the next accept, but never while the order may be paid")
    void anExpiredCheckoutOpensAFreshOrder() throws Exception {
        User owner = customer("9820008071");
        User desk = staff("9820008072", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(desk, id, "assigned", 200);
        propose(desk, id, "{\"rent\":25000,\"reason\":\"Owner agreed\"}").andExpect(status().isCreated());
        String amendment = openAmendment(id);
        accept(owner, id, amendment).andExpect(status().isOk());
        String expired = orderOf(amendment);

        doReturn(Optional.empty()).when(gateway).resumeSession(expired);
        accept(owner, id, amendment).andExpect(status().isOk())
                .andExpect(jsonPath("$.paymentSessionId", notNullValue()));
        String fresh = orderOf(amendment);
        assertThat(fresh).isNotNull().isNotEqualTo(expired);

        doReturn(Optional.empty()).when(gateway).resumeSession(fresh);
        doReturn(true).when(gateway).paid(fresh);
        accept(owner, id, amendment).andExpect(status().isConflict());
        assertThat(orderOf(amendment)).isEqualTo(fresh);
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
        assertThat(notice(owner, "service.amendment-withdrawn"))
                .containsEntry("title", "Revised terms withdrawn");
        accept(owner, id, amendment).andExpect(status().isNotFound());
        deliverSigned(order, true);
        read(owner, id).andExpect(jsonPath("$.details.rent").value(20000));
        shareDraft(desk, id, 200);
    }
}
