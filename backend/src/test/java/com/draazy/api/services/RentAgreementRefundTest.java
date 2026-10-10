package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

// Everything paid comes back until GRAS duty is paid; after that only the service fee can refund.
// A second operator must approve so no refund leaves on one person's word.
@DisplayName("Rent agreement refunds — one operator asks, a second approves, within what D-b allows")
class RentAgreementRefundTest extends ServiceFixtures {

    private static final String TERMS = "{\"type\":\"rent-agreement\",\"details\":{\"rent\":20000,"
            + "\"deposit\":60000,\"months\":11,\"_state\":{\"prop\":{\"gramPanchayat\":false},\"terms\":{\"rent\":\"20000\",\"deposit\":\"60000\","
            + "\"months\":\"11\"}}}}";

    private static final long STATUTORY = 600 + 1000 + 300;

    private static final String GRN = "MH012345678901234567E";

    private String raiseWithTerms(User owner) throws Exception {
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content(TERMS))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String id = field(json, "id");
        serviceRequests.applyWebhookOutcome(paymentRef(id), true, 0);
        return id;
    }

    private long paid(String id) {
        return requestRepo.findById(UUID.fromString(id)).orElseThrow().getAmount();
    }

    private ResultActions summary(User caller, String id) throws Exception {
        em.flush();
        em.clear();
        return mvc.perform(get(Routes.ServiceRequests.REFUNDS, id).header(HttpHeaders.AUTHORIZATION, bearer(caller)));
    }

    private ResultActions ask(User caller, String id, long amount, boolean dutyPaid, String grn) throws Exception {
        String body = "{\"amount\":" + amount + ",\"dutyPaid\":" + dutyPaid
                + (grn == null ? "" : ",\"grn\":\"" + grn + "\"") + ",\"reason\":\"Customer cancelled before the visit\"}";
        return mvc.perform(post(Routes.ServiceRequests.REFUNDS, id)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions decideRefund(User caller, String id, String refundId, boolean approve) throws Exception {
        return mvc.perform(post(approve ? Routes.ServiceRequests.REFUND_APPROVE : Routes.ServiceRequests.REFUND_REJECT,
                        id, refundId)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON).content("{\"note\":\"Checked against the GRAS receipt\"}"));
    }

    private String openRefund(User caller, String id) throws Exception {
        String json = summary(caller, id).andReturn().getResponse().getContentAsString();
        return field(json.substring(json.indexOf("\"refunds\"")), "id");
    }

    @Test
    @DisplayName("before the duty is paid the whole charge comes back, once, and only on a second operator's approval")
    void fullRefundBeforeTheDuty() throws Exception {
        User owner = customer("9820009001");
        User maker = staff("9820009002", Teams.RENTAL);
        User checker = staff("9820009003", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(maker, id, "assigned", 200);
        long paid = paid(id);

        summary(maker, id).andExpect(status().isOk())
                .andExpect(jsonPath("$.paid").value(paid))
                .andExpect(jsonPath("$.refunded").value(0))
                .andExpect(jsonPath("$.refundableBeforeDuty").value(paid))
                .andExpect(jsonPath("$.refundableAfterDuty").value(paid - STATUTORY))
                .andExpect(jsonPath("$.dutyPaidOnRecord").value(false));

        ask(maker, id, paid + 1, false, null).andExpect(status().isUnprocessableEntity());
        ask(checker, id, paid, false, null).andExpect(status().isConflict());
        ask(maker, id, paid, false, null).andExpect(status().isCreated())
                .andExpect(jsonPath("$.refunds[0].status").value("requested"))
                .andExpect(jsonPath("$.refunds[0].amount").value(paid))
                .andExpect(jsonPath("$.refunds[0].mine").value(true));
        ask(maker, id, 100, false, null).andExpect(status().isConflict());

        String refund = openRefund(checker, id);
        decideRefund(maker, id, refund, true).andExpect(status().isForbidden());
        decideRefund(checker, id, refund, true).andExpect(status().isOk())
                .andExpect(jsonPath("$.refunds[0].status").value("approved"))
                .andExpect(jsonPath("$.refunds[0].gatewayRefundId", startsWith("mock_refund_")))
                .andExpect(jsonPath("$.refunded").value(paid))
                .andExpect(jsonPath("$.refundableBeforeDuty").value(0));
        decideRefund(checker, id, refund, true).andExpect(status().isNotFound());
        ask(maker, id, 1, false, null).andExpect(status().isUnprocessableEntity());

        mvc.perform(get(Routes.ServiceRequests.BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.timeline[*].event", hasItem("refund.approved")));
        assertThat(jdbc.queryForMap("select title, link from notifications where user_id = ? and type = ?",
                owner.getId(), "service.refund-approved"))
                .containsEntry("title", Notifier.rupees(paid) + " refund on its way")
                .containsEntry("link", "/services/rent-agreement");
    }

    @Test
    @DisplayName("once the duty is paid only the service fee comes back, and the maker names the GRAS challan")
    void serviceFeeOnlyAfterTheDuty() throws Exception {
        User owner = customer("9820009011");
        User maker = staff("9820009012", Teams.RENTAL);
        User checker = staff("9820009013", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(maker, id, "assigned", 200);
        long fee = paid(id) - STATUTORY;

        ask(maker, id, fee, true, null).andExpect(status().isUnprocessableEntity());
        ask(maker, id, fee, true, "12345").andExpect(status().isUnprocessableEntity());
        ask(maker, id, fee + 1, true, GRN).andExpect(status().isUnprocessableEntity());
        ask(maker, id, fee, true, GRN).andExpect(status().isCreated())
                .andExpect(jsonPath("$.refunds[0].dutyPaid").value(true))
                .andExpect(jsonPath("$.refunds[0].grn").value(GRN));

        decideRefund(checker, id, openRefund(checker, id), false).andExpect(status().isOk())
                .andExpect(jsonPath("$.refunds[0].status").value("rejected"))
                .andExpect(jsonPath("$.refunded").value(0));
        ask(maker, id, 500, true, GRN).andExpect(status().isCreated());
    }

    private String approvedRefund(User maker, User checker, String id, long amount) throws Exception {
        ask(maker, id, amount, false, null).andExpect(status().isCreated());
        String refund = openRefund(checker, id);
        decideRefund(checker, id, refund, true).andExpect(status().isOk());
        return refund;
    }

    @Test
    @DisplayName("a refund of everything paid closes the request; a partial one leaves it open")
    void aFullRefundClosesTheRequest() throws Exception {
        User owner = customer("9820009041");
        User maker = staff("9820009042", Teams.RENTAL);
        User checker = staff("9820009043", Teams.RENTAL);
        String partial = raiseWithTerms(owner);
        String full = raiseWithTerms(owner);
        setStatus(maker, partial, "assigned", 200);
        setStatus(maker, full, "assigned", 200);

        approvedRefund(maker, checker, partial, 500);
        expectStatus(owner, partial, "assigned");

        approvedRefund(maker, checker, full, paid(full));
        expectStatus(owner, full, "cancelled");
        mvc.perform(get(Routes.ServiceRequests.BY_ID, full).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.timeline[*].event", hasItem("refund.cancelled-request")));
        assertThat(jdbc.queryForMap("select title from notifications where user_id = ? and type = ?",
                owner.getId(), "service.refund-cancelled")).containsEntry("title", "Request cancelled");
    }

    @Test
    @DisplayName("the gateway's refund webhook reopens a cancelled refund once, and ignores success and strangers")
    void theRefundWebhookReportsWhatTheGatewayDid() throws Exception {
        User owner = customer("9820009051");
        User maker = staff("9820009052", Teams.RENTAL);
        User checker = staff("9820009053", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(maker, id, "assigned", 200);
        long paid = paid(id);
        String merchantId = "rf_" + approvedRefund(maker, checker, id, 500).replace("-", "");

        deliverRefundSigned(merchantId, "SUCCESS");
        deliverRefundSigned("rf_00000000000000000000000000000000", "CANCELLED");
        deliverRefundSigned("not-ours", "CANCELLED");
        summary(maker, id).andExpect(jsonPath("$.refunds[0].status").value("approved"))
                .andExpect(jsonPath("$.refunded").value(500));

        deliverRefundSigned(merchantId, "CANCELLED");
        deliverRefundSigned(merchantId, "CANCELLED");
        summary(maker, id).andExpect(jsonPath("$.refunds[0].status").value("failed"))
                .andExpect(jsonPath("$.refunded").value(0))
                .andExpect(jsonPath("$.refundableBeforeDuty").value(paid));
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.timeline[?(@.event == 'refund.failed')]", org.hamcrest.Matchers.hasSize(1)));
        assertThat(jdbc.queryForList("select 1 from notifications where user_id = ? and type = ?",
                maker.getId(), "service.refund-failed")).hasSize(1);

        ask(maker, id, 500, false, null).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a registered agreement has paid its duty, whatever the maker says")
    void registrationProvesTheDutyPaid() throws Exception {
        User owner = customer("9820009021");
        User maker = staff("9820009022", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(maker, id, "assigned", 200);
        shareDraft(maker, id, 200);
        openDraft(owner, id, 204);
        decide(owner, id, "approve", 200);
        finalDoc(maker, id, 201);
        long paid = paid(id);

        summary(maker, id).andExpect(jsonPath("$.dutyPaidOnRecord").value(true));
        ask(maker, id, paid, false, null).andExpect(status().isUnprocessableEntity());
        ask(maker, id, paid - STATUTORY, false, null).andExpect(status().isCreated())
                .andExpect(jsonPath("$.refunds[0].dutyPaid").value(true))
                .andExpect(jsonPath("$.refunds[0].grn", startsWith("MH")));
    }

    @Test
    @DisplayName("customers, other desks and unpaid requests are refused")
    void refusals() throws Exception {
        User owner = customer("9820009031");
        User legal = staff("9820009032", Teams.LEGAL);
        User maker = staff("9820009033", Teams.RENTAL);
        String id = raiseWithTerms(owner);
        setStatus(maker, id, "assigned", 200);

        ask(owner, id, 100, false, null).andExpect(status().isForbidden());
        summary(owner, id).andExpect(status().isForbidden());
        ask(legal, id, 100, false, null).andExpect(status().isForbidden());

        String unpaid = raiseUnpaid(owner, listing(owner));
        ask(admin("9820009034"), unpaid, 100, false, null).andExpect(status().isConflict());
    }
}
