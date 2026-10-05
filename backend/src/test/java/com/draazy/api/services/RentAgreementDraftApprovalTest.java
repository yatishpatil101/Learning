package com.draazy.api.services;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import com.draazy.api.services.request.ServiceRequestStatus;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Rent agreement draft approvals")
class RentAgreementDraftApprovalTest extends ServiceFixtures {

    @Test
    @DisplayName("the requester approval waits for an inline tenant OTP before the draft is approved")
    void inlineTenantApprovesByOtp() throws Exception {
        User owner = customer("9820006101");
        User desk = staff("9820006102", Teams.RENTAL);
        String tenantMobile = "9820006103";
        String id = raiseWithState(owner, listing(owner), "{\"owner\":{\"oMobile\":\"" + owner.getMobile()
                + "\"},\"tenants\":[{\"name\":\"Ria\",\"mobile\":\"" + tenantMobile
                + "\"}],\"terms\":{\"rent\":\"25000\",\"months\":\"11\"}}");

        setStatus(desk, id, "assigned", 200);
        shareDraft(desk, id, 200);
        openDraft(owner, id, 204);
        decide(owner, id, "approve", 200);

        String detail = detail(owner, id);
        org.assertj.core.api.Assertions.assertThat(detail).contains("\"approved\":1", "\"total\":2");
        String partyKey = detail.replaceAll("(?s)^.*?\"key\":\"([^\"]+)\",\"label\":\"Tenant 1\".*$", "$1");
        mvc.perform(post(Routes.ServiceRequests.DRAFT_OTP, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"partyKey\":\"" + partyKey + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.approvalRecorded").value(false));
        forceOtp(tenantMobile);
        mvc.perform(post(Routes.ServiceRequests.DRAFT_OTP, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"partyKey\":\"" + partyKey + "\",\"otp\":\"424242\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.approvalRecorded").value(true));
        expectStatus(owner, id, "approved");
    }

    @Test
    @DisplayName("a high-rent draft waits for a different operator before the customer sees it")
    void riskyDraftNeedsSecondOperator() throws Exception {
        User owner = customer("9820006111");
        User holder = staff("9820006112", Teams.RENTAL);
        User checker = staff("9820006113", Teams.RENTAL);
        String id = raiseWithState(owner, listing(owner), "{\"owner\":{\"oMobile\":\"" + owner.getMobile()
                + "\"},\"tenants\":[{\"name\":\"Ria\",\"mobile\":\"9820006114\"}],"
                + "\"terms\":{\"rent\":\"55000\",\"months\":\"11\"}}");

        setStatus(holder, id, "assigned", 200);
        shareDraft(holder, id, 200);

        mvc.perform(get(Routes.ServiceRequests.BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("assigned"))
                .andExpect(jsonPath("$.documents[?(@.category=='draft')]").isEmpty());
        mvc.perform(post(Routes.ServiceRequests.DRAFT_CHECK, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(holder))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"release\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post(Routes.ServiceRequests.DRAFT_CHECK, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"release\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("draft-shared"))
                .andExpect(jsonPath("$.draftCheck.reasons[0]").value("rent_ge_50000"));
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("draft-shared"))
                .andExpect(jsonPath("$.documents[?(@.category=='draft')]", org.hamcrest.Matchers.hasSize(1)));
    }

    private String raiseWithState(User caller, Property property, String stateJson) throws Exception {
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"rent-agreement\",\"propertyId\":\"" + property.getId()
                                + "\",\"details\":{\"rent\":" + rentFrom(stateJson) + ",\"deposit\":100000,\"months\":11,"
                                + "\"startDate\":\"2026-04-01\",\"_state\":" + stateJson + "}}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = field(json, "id");
        requestRepo.findById(UUID.fromString(id))
                .filter(r -> r.getStatus() == ServiceRequestStatus.AWAITING_PAYMENT)
                .ifPresent(r -> serviceRequests.applyWebhookOutcome(paymentRef(id), true, 0));
        return id;
    }

    private static int rentFrom(String stateJson) {
        return stateJson.contains("\"rent\":\"55000\"") ? 55000 : 25000;
    }

    private void forceOtp(String mobile) {
        em.flush();
        jdbc.update("update otp_codes set code_hash = encode(sha256(convert_to('424242', 'UTF8')), 'hex')"
                + " where id = (select id from otp_codes where mobile = ? order by created_at desc limit 1)", mobile);
        em.clear();
    }
}
