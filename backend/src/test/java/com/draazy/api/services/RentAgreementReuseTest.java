package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.engagement.notification.NotificationRepository;
import com.draazy.api.identity.user.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("A rent agreement reuses what the platform already holds")
class RentAgreementReuseTest extends ServiceFixtures {

    @Autowired
    private NotificationRepository notifications;

    @Nested
    @DisplayName("filing a personal-vault paper on the request")
    class FromVault {

        @Test
        @DisplayName("the caller's own paper is filed without a re-upload and reads back with a URL")
        void ownPaperIsFiled() throws Exception {
            User owner = customer("9820000801");
            String id = create(owner);
            String vaultId = vaultUpload(owner, "PAN Card");

            fromVault(owner, id, vaultId, "licensor-0-pan", 201)
                    .andExpect(jsonPath("$.category").value("licensor-0-pan"))
                    .andExpect(jsonPath("$.fileName").value("pan.pdf"));
            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.documents[0].category").value("licensor-0-pan"))
                    .andExpect(jsonPath("$.documents[0].url").isNotEmpty());
        }

        @Test
        @DisplayName("somebody else's vault paper is a 404, and the desk may not file from a vault at all")
        void onlyTheOwnersVault() throws Exception {
            User owner = customer("9820000802");
            User stranger = customer("9820000803");
            String id = create(owner);
            String strangers = vaultUpload(stranger, "PAN Card");

            fromVault(owner, id, strangers, "licensor-0-pan", 404);
            fromVault(owner, id, "not-a-uuid", "licensor-0-pan", 404);
            fromVault(stranger, id, strangers, "licensor-0-pan", 404);
            fromVault(admin("9820000804"), id, vaultUpload(owner, "PAN Card"), "licensor-0-pan", 403);
        }

        @Test
        @DisplayName("the side rules of a direct upload hold: an invited tenant cannot file the owner's papers")
        void sideRulesHold() throws Exception {
            User owner = customer("9820000805");
            User tenant = customer("9820000806");
            String id = create(owner);
            String party = invite(owner, id, tenant, 201);
            decide(tenant, field(party, "id"), "accept");
            String tenantPan = vaultUpload(tenant, "PAN Card");

            fromVault(tenant, id, tenantPan, "licensor-0-pan", 403);
            fromVault(tenant, id, tenantPan, "tenant-0-pan", 201);
            fromVault(owner, id, vaultUpload(owner, "PAN Card"), "draft", 422);
        }
    }

    @Nested
    @DisplayName("a declined invitation")
    class Declined {

        @Test
        @DisplayName("frees the side for somebody else, but not for the person who declined")
        void clearAndReinvite() throws Exception {
            User owner = customer("9820000811");
            User first = customer("9820000812");
            User second = customer("9820000813");
            String id = create(owner);
            String partyId = field(invite(owner, id, first, 201), "id");
            decide(first, partyId, "decline");

            withdraw(first, id, partyId, 404);
            withdraw(owner, id, partyId, 204);
            invite(owner, id, first, 409);
            String again = field(invite(owner, id, second, 201), "id");
            decide(second, again, "accept");
            withdraw(owner, id, again, 409);
        }
    }

    @Nested
    @DisplayName("the counterparty finishing their half")
    class CounterpartyDone {

        @Test
        @DisplayName("tells the requester, who alone can open checkout, and nobody else")
        void requesterIsTold() throws Exception {
            User owner = customer("9820000821");
            User tenant = customer("9820000822");
            String id = create(owner);
            decide(tenant, field(invite(owner, id, tenant, 201), "id"), "accept");

            mvc.perform(put(Routes.ServiceRequests.PARTY_DETAILS, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"details\":{\"_state\":{\"owner\":{\"oMobile\":\"9820000821\"},"
                                    + "\"tenants\":[{\"name\":\"Ria\",\"mobile\":\"9820000822\"}]}}}"))
                    .andExpect(status().isOk());

            assertThat(notifications.findAll())
                    .filteredOn(n -> "service.party-details-submitted".equals(n.getType()))
                    .filteredOn(n -> n.getUserId().equals(owner.getId()) || n.getUserId().equals(tenant.getId()))
                    .singleElement()
                    .satisfies(n -> {
                        assertThat(n.getUserId()).isEqualTo(owner.getId());
                        assertThat(n.getLink()).isEqualTo("/services/rent-agreement");
                    });
        }
    }

    private String create(User owner) throws Exception {
        String body = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"rent-agreement\",\"details\":{\"_state\":"
                                + "{\"owner\":{\"oMobile\":\"" + owner.getMobile() + "\"}}}}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return field(body, "id");
    }

    private String vaultUpload(User caller, String category) throws Exception {
        String body = mvc.perform(multipart(Routes.MeDocuments.PERSONAL)
                        .file(new MockMultipartFile("file", "pan.pdf", "application/pdf", "%PDF-1.4".getBytes()))
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return field(body, "id");
    }

    private ResultActions fromVault(User caller, String id, String documentId, String category, int expected)
            throws Exception {
        return mvc.perform(post(Routes.ServiceRequests.DOCS_FROM_VAULT, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"documentId\":\"" + documentId + "\",\"category\":\"" + category + "\"}"))
                .andExpect(status().is(expected));
    }

    private String invite(User owner, String id, User invitee, int expected) throws Exception {
        return mvc.perform(post(Routes.ServiceRequests.PARTIES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"tenant\",\"mobile\":\"" + invitee.getMobile() + "\"}"))
                .andExpect(status().is(expected))
                .andReturn().getResponse().getContentAsString();
    }

    private void decide(User invitee, String partyId, String decision) throws Exception {
        mvc.perform(post(Routes.ServiceRequests.INVITE_DECISION, partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(invitee))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"" + decision + "\"}"))
                .andExpect(status().isOk());
    }

    private void withdraw(User caller, String id, String partyId, int expected) throws Exception {
        mvc.perform(delete(Routes.ServiceRequests.PARTY_BY_ID, id, partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().is(expected));
    }
}
