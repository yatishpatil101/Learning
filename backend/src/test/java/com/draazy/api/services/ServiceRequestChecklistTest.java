package com.draazy.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

// The live API must own checklist names; frontend-only mock data emptied the missing-docs tracker.
@DisplayName("D120 — service-request document checklist")
class ServiceRequestChecklistTest extends ServiceFixtures {

    // The point of the endpoint is the absent items, so a fresh request must return all of them with nothing done —
    // not an empty list.
    @Test
    @DisplayName("a fresh request lists every item, none of them done")
    void freshRequestListsEveryItemUnticked() throws Exception {
        User buyer = customer("9820000801");
        String id = raise(buyer, "rent-agreement", listing(buyer));

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(7))
                .andExpect(jsonPath("$.ready").value(0))
                .andExpect(jsonPath("$.items", hasSize(7)))
                .andExpect(jsonPath("$.items[0].id").value("licensor-0-pan"))
                .andExpect(jsonPath("$.items[0].name").value("Licensor 1 — PAN card"))
                .andExpect(jsonPath("$.items[0].done").value(false));
    }

    // Would fail if the match were made on file name or mime type, or if `ready` were counted from the document list
    // rather than the items.
    @Test
    @DisplayName("a non-rent request keeps the legacy five-item checklist")
    void nonRentRequestKeepsTheStaticChecklist() throws Exception {
        User buyer = customer("9820000809");
        String id = raise(buyer, "legal", listing(buyer));

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(5))
                .andExpect(jsonPath("$.items[0].id").value("owner-id"));
    }

    // Counting it would inflate the badge with output rather than input — a customer who had sent nothing would see
    // progress because staff shared a draft.
    @Test
    @DisplayName("a document filed under an item's id ticks exactly that item")
    void uploadTicksTheMatchingItem() throws Exception {
        User buyer = customer("9820000802");
        String id = raise(buyer, "rent-agreement", listing(buyer));

        upload(buyer, id, "licensor-0-pan");
        upload(buyer, id, "licensor-0-pan");

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(1))
                .andExpect(jsonPath("$.items[0].done").value(true))
                .andExpect(jsonPath("$.items[1].done").value(false));
    }

    // An id rather than a URL, so this route never mints a download credential and the bytes stay behind {@code
    // getServiceRequest}, where the vault's read rules already live.
    @Test
    @DisplayName("NRI and foreign parties get passport and visa slots instead of Aadhaar slots")
    void offlinePartiesGetPassportSlots() throws Exception {
        User buyer = customer("9820000810");
        String id = createWithState(buyer, "{\"owner\":{\"oMobile\":\"9820000810\"},"
                + "\"tenants\":[{\"residency\":\"foreign\",\"passport\":\"Z1234567\",\"visaOci\":\"OCI-123\"}]}");

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id=='tenant-0-aadhaar')]", hasSize(0)))
                .andExpect(jsonPath("$.items[?(@.id=='tenant-0-passport')]", hasSize(1)))
                .andExpect(jsonPath("$.items[?(@.id=='tenant-0-visa')]", hasSize(1)));
    }

    @Test
    @DisplayName("tenant police proofs join the checklist only when the portal needs them")
    void tenantPoliceProofsFollowPortalConditions() throws Exception {
        assertTenantPoliceItems("9820000811", "{\"occupation\":\"salaried\"}", 0, 0, 0);
        assertTenantPoliceItems("9820000812", police("uid", true, "uid", "student"), 0, 0, 0);
        assertTenantPoliceItems("9820000813", police("passport", true, "uid", "student"), 1, 0, 0);
        assertTenantPoliceItems("9820000814", police("uid", false, "passport", "student"), 0, 1, 0);
        assertTenantPoliceItems("9820000815", police("uid", true, "uid", "salaried"), 0, 0, 1);
    }

    // The guard is the same one `GET /service-requests/{id}` uses, deliberately: a checklist that leaked existence
    // would be a side door around it.
    @Test
    @DisplayName("the desk's draft and final document do not count towards the customer's total")
    void deskOutputIsNotCustomerInput() throws Exception {
        User buyer = customer("9820000803");
        User desk = staff("9820000804", Teams.RENTAL);
        Property p = listing(buyer);
        String id = raise(buyer, "rent-agreement", p);

        setStatus(desk, id, "assigned", 200);
        shareDraft(desk, id, 200);
        openDraft(buyer, id, 204);
        decide(buyer, id, "approve", 200);
        finalDoc(desk, id, 201);

        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.documents", hasSize(9)));

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(7))
                .andExpect(jsonPath("$.total").value(7));
    }

    @Test
    @DisplayName("a ticked item names the document but carries no URL")
    void tickedItemCarriesAnIdNotAUrl() throws Exception {
        User buyer = customer("9820000805");
        String id = raise(buyer, "rent-agreement", listing(buyer));
        upload(buyer, id, "tenant-0-photo");

        String json = mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[6].id").value("tenant-0-photo"))
                .andExpect(jsonPath("$.items[6].documentId").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        org.assertj.core.api.Assertions.assertThat(json).doesNotContain("http");
    }

    @Test
    @DisplayName("a stranger gets 404, and the desk that owns the request gets the checklist")
    void strangersGet404AndTheDeskGetsIt() throws Exception {
        User buyer = customer("9820000806");
        User stranger = customer("9820000807");
        User desk = staff("9820000808", Teams.RENTAL);
        String id = raise(buyer, "rent-agreement", listing(buyer));

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(7));

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id))
                .andExpect(status().isUnauthorized());
    }

    private void upload(User caller, String id, String category) throws Exception {
        mvc.perform(multipart(Routes.ServiceRequests.DOCS, id)
                        .file(new MockMultipartFile("file", "scan.pdf", "application/pdf",
                                "%PDF-1.4".getBytes()))
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isCreated());
    }

    private String createWithState(User caller, String state) throws Exception {
        String json = mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"rent-agreement\",\"details\":{\"_state\":" + state + "}}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return field(json, "id");
    }

    private void assertTenantPoliceItems(String mobile, String tenant, int address, int previous, int income) throws Exception {
        User buyer = customer(mobile);
        String id = createWithState(buyer, "{\"owner\":{\"oMobile\":\"" + mobile + "\"},\"tenants\":[" + tenant + "]}");
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id=='tenant-0-addressproof')]", hasSize(address)))
                .andExpect(jsonPath("$.items[?(@.id=='tenant-0-prevaddressproof')]", hasSize(previous)))
                .andExpect(jsonPath("$.items[?(@.id=='tenant-0-income')]", hasSize(income)));
    }

    private static String police(String addressProof, boolean previousSame, String previousProof, String occupation) {
        String previous = previousSame ? ""
                : ",\"previous\":{\"address\":\"12 MG Road\",\"pincode\":\"411001\",\"village\":\"Pune\",\"policeStation\":\"Shivajinagar\"}";
        String workplace = "student".equals(occupation) ? ""
                : ",\"workplaceAddress\":\"Hinjewadi Phase 1\",\"workIdProofType\":\"Employee ID\"";
        return "{\"occupation\":\"" + occupation + "\",\"police\":{\"addressProofType\":\"" + addressProof
                + "\",\"previousSameAsPermanent\":" + previousSame
                + ",\"previousAddressProofType\":\"" + previousProof + "\"" + previous + workplace + "}}";
    }
}
