package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.jayway.jsonpath.JsonPath;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;

// A filed paper is draftable only after review; rejection reasons drive the customer's re-upload.
@DisplayName("Rent agreement documents — verify or reject each paper before drafting")
class RentAgreementDocumentReviewTest extends ServiceFixtures {

    private static final String[] PAPERS = {"licensor-0-pan", "licensor-0-aadhaar", "licensor-0-photo",
        "ownership-proof", "tenant-0-pan", "tenant-0-aadhaar", "tenant-0-photo"};

    private void upload(User caller, String id, String category) throws Exception {
        mvc.perform(multipart(Routes.ServiceRequests.DOCS, id)
                        .file(new MockMultipartFile("file", "scan.pdf", "application/pdf", "%PDF-1.4".getBytes()))
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().isCreated());
    }

    private String documentId(User caller, String id, int item) throws Exception {
        return JsonPath.read(mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andReturn().getResponse().getContentAsString(), "$.items[" + item + "].documentId");
    }

    private ResultActions review(User caller, String id, String category, String documentId, String verdict,
            String reason) throws Exception {
        String why = reason == null ? "" : ",\"reason\":\"" + reason + "\"";
        return mvc.perform(put(Routes.ServiceRequests.CHECKLIST_ITEM, id, category)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"documentId\":\"" + documentId + "\",\"verdict\":\"" + verdict + "\"" + why + "}"));
    }

    private void postDraft(User desk, String id, int expected, String... message) throws Exception {
        ResultActions result = mvc.perform(multipart(Routes.ServiceRequests.DRAFT, id)
                        .file(new MockMultipartFile("file", "draft.pdf", "application/pdf", "%PDF-1.4 d".getBytes()))
                        .param("checks", DRAFT_CHECKS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(status().is(expected));
        for (String part : message) {
            result.andExpect(jsonPath("$.message", containsString(part)));
        }
    }

    @Test
    @DisplayName("the draft waits for every paper to be verified; a rejection names its reason and a re-upload is pending again")
    void draftWaitsForVerifiedPapers() throws Exception {
        User owner = customer("9820006001");
        User desk = staff("9820006002", Teams.RENTAL);
        String id = raise(owner, "rent-agreement", listing(owner));
        for (String paper : PAPERS) {
            upload(owner, id, paper);
        }

        review(desk, id, PAPERS[0], documentId(desk, id, 0), "verified", null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("Take this request")));
        setStatus(desk, id, "assigned", 200);
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.items[0].review").value("pending"));
        postDraft(desk, id, 409, "Verify every document before sharing the draft", "Licensor 1 — PAN card");

        for (int i = 0; i < PAPERS.length; i++) {
            review(desk, id, PAPERS[i], documentId(desk, id, i), "verified", null).andExpect(status().isOk());
        }
        String blurred = documentId(desk, id, 1);
        review(desk, id, PAPERS[1], blurred, "rejected", null).andExpect(status().isUnprocessableEntity());
        review(desk, id, PAPERS[1], blurred, "rejected", "The Aadhaar scan is blurred; the number is unreadable")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[1].review").value("rejected"))
                .andExpect(jsonPath("$.items[0].review").value("verified"));
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.items[1].reason").value("The Aadhaar scan is blurred; the number is unreadable"));
        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id = ? and type = ?",
                Integer.class, owner.getId(), "service.document-rejected")).isEqualTo(1);
        postDraft(desk, id, 409, "Licensor 1 — Aadhaar card");

        upload(owner, id, PAPERS[1]);
        review(desk, id, PAPERS[1], blurred, "verified", null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("newer copy")));
        String fresh = documentId(desk, id, 1);
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.items[1].review").value("pending"))
                .andExpect(jsonPath("$.items[1].reason").isEmpty());
        review(desk, id, PAPERS[1], fresh, "verified", null).andExpect(status().isOk());

        postDraft(desk, id, 200);
        expectStatus(owner, id, "draft-shared");
    }

    @Test
    @DisplayName("a rejection reaches the side that files the paper, and another side's identity reason stays hidden")
    void rejectionsStayOnTheirSide() throws Exception {
        User owner = customer("9820006031");
        User tenant = customer("9820006032");
        User desk = staff("9820006033", Teams.RENTAL);
        String id = raise(owner, "rent-agreement", listing(owner));
        for (String paper : PAPERS) {
            upload(owner, id, paper);
        }
        jdbc.update("insert into service_request_parties (request_id, invite_expires_at, role, status,"
                + " invited_by, user_id) values (?::uuid, now() + interval '90 days', 'tenant', 'accepted', ?, ?)",
                id, owner.getId(), tenant.getId());
        setStatus(desk, id, "assigned", 200);
        review(desk, id, PAPERS[0], documentId(desk, id, 0), "rejected", "PAN is cut off").andExpect(status().isOk());
        review(desk, id, PAPERS[5], documentId(desk, id, 5), "rejected", "Aadhaar name differs").andExpect(status().isOk());

        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id = ? and type = ?",
                Integer.class, owner.getId(), "service.document-rejected")).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from notifications where user_id = ? and type = ?",
                Integer.class, tenant.getId(), "service.document-rejected")).isEqualTo(1);
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.items[0].canUpload").value(true))
                .andExpect(jsonPath("$.items[0].reason").value("PAN is cut off"))
                .andExpect(jsonPath("$.items[5].canUpload").value(false))
                .andExpect(jsonPath("$.items[5].review").value("rejected"))
                .andExpect(jsonPath("$.items[5].reason").isEmpty());
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id).header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                .andExpect(jsonPath("$.items[5].canUpload").value(true))
                .andExpect(jsonPath("$.items[5].reason").value("Aadhaar name differs"))
                .andExpect(jsonPath("$.items[0].canUpload").value(false))
                .andExpect(jsonPath("$.items[0].reason").isEmpty())
                .andExpect(jsonPath("$.items[3].canUpload").value(false));
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id).header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                .andExpect(jsonPath("$.items[0].reason").value("PAN is cut off"))
                .andExpect(jsonPath("$.items[5].canUpload").value(true));
    }

    @Test
    @DisplayName("a paper not on the checklist, an unknown verdict, an empty slot or another desk's matter is refused")
    void badReviewsAreRefused() throws Exception {
        User owner = customer("9820006011");
        User desk = staff("9820006012", Teams.RENTAL);
        User colleague = staff("9820006013", Teams.RENTAL);
        String id = raise(owner, "rent-agreement", listing(owner));
        upload(owner, id, PAPERS[0]);
        setStatus(desk, id, "assigned", 200);
        String pan = documentId(desk, id, 0);

        review(desk, id, "licensor-3-pan", pan, "verified", null)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("not on this request's checklist")));
        review(desk, id, PAPERS[0], pan, "approved", null).andExpect(status().isUnprocessableEntity());
        review(desk, id, PAPERS[3], pan, "verified", null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", containsString("Nothing is filed under")));
        review(colleague, id, PAPERS[0], pan, "verified", null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", allOf(containsString("holds this request"),
                        not(containsString("Take")))));
        review(owner, id, PAPERS[0], pan, "verified", null).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a valuation keeps its presence-only checklist and drafts without reviews")
    void otherTypesAreNotGated() throws Exception {
        User owner = customer("9820006021");
        User desk = staff("9820006022", Teams.VALUATION);
        String id = raise(owner, "valuation", listing(owner));
        setStatus(desk, id, "assigned", 200);
        postDraft(desk, id, 200);
    }
}
