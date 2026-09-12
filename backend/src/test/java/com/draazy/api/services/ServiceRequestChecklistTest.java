package com.draazy.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;

/**
 * The document checklist on a service request (D120).
 *
 * <p>The tracker could always show what a customer had uploaded; it could never show what was still
 * missing, which is the half a customer acts on. The list of named items lived only in the frontend
 * mock, so switching the tracker to the live API emptied its document column.
 *
 * <p>Organised around what a regression would break: the list is complete whether or not anything
 * has been filed, "done" follows the documents rather than a stored flag, the desk's own output
 * does not count towards the customer's total, and a stranger gets 404 rather than a shape.
 */
@DisplayName("D120 — service-request document checklist")
class ServiceRequestChecklistTest extends ServiceFixtures {

    /**
     * The point of the endpoint is the absent items, so a fresh request must return all of them
     * with nothing done — not an empty list.
     *
     * <p>Would fail if: the checklist were derived from the documents that exist rather than folded
     * onto a fixed catalogue, which is the shape the frontend mapper had to fake with {@code []}.
     */
    @Test
    @DisplayName("a fresh request lists every item, none of them done")
    void freshRequestListsEveryItemUnticked() throws Exception {
        User buyer = customer("9820000801");
        String id = raise(buyer, "rent-agreement", listing(buyer));

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(5))
                .andExpect(jsonPath("$.ready").value(0))
                .andExpect(jsonPath("$.items", hasSize(5)))
                .andExpect(jsonPath("$.items[0].id").value("owner-id"))
                .andExpect(jsonPath("$.items[0].name").value("Owner Aadhaar + PAN"))
                .andExpect(jsonPath("$.items[0].done").value(false));
    }

    /**
     * Uploading under an item's id is what ticks it — one vocabulary, read and written.
     *
     * <p>Would fail if: the match were made on file name or mime type; or if {@code ready} were
     * counted from the document list rather than from the items, which would let two files under
     * one category report "2 of 5".
     */
    @Test
    @DisplayName("a document filed under an item's id ticks exactly that item")
    void uploadTicksTheMatchingItem() throws Exception {
        User buyer = customer("9820000802");
        String id = raise(buyer, "rent-agreement", listing(buyer));

        upload(buyer, id, "owner-id");
        upload(buyer, id, "owner-id");

        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(1))
                .andExpect(jsonPath("$.items[0].done").value(true))
                .andExpect(jsonPath("$.items[1].done").value(false));
    }

    /**
     * The desk's own paperwork is on the request but is not something the customer was asked for.
     * Counting it would inflate the badge with output rather than input — a customer who had sent
     * nothing would see progress because staff shared a draft.
     */
    @Test
    @DisplayName("the desk's draft and final document do not count towards the customer's total")
    void deskOutputIsNotCustomerInput() throws Exception {
        User buyer = customer("9820000803");
        User desk = staff("9820000804", Teams.RENTAL);
        Property p = listing(buyer);
        String id = raise(buyer, "rent-agreement", p);

        setStatus(desk, id, "assigned", 200);
        shareDraft(desk, id, 200);
        decide(buyer, id, "approve", 200);
        finalDoc(desk, id, 201);

        // Both files are genuinely on the request...
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(jsonPath("$.documents", hasSize(2)));

        // ...and neither is a checklist item.
        mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ready").value(0));
    }

    /**
     * The checklist reports which items are satisfied; it does not hand out the documents. An id
     * rather than a URL, so this route never mints a download credential and the bytes stay behind
     * {@code getServiceRequest}, where the vault's read rules already live.
     */
    @Test
    @DisplayName("a ticked item names the document but carries no URL")
    void tickedItemCarriesAnIdNotAUrl() throws Exception {
        User buyer = customer("9820000805");
        String id = raise(buyer, "rent-agreement", listing(buyer));
        upload(buyer, id, "electricity-bill");

        String json = mvc.perform(get(Routes.ServiceRequests.CHECKLIST, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[4].id").value("electricity-bill"))
                .andExpect(jsonPath("$.items[4].documentId").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        org.assertj.core.api.Assertions.assertThat(json).doesNotContain("http");
    }

    /**
     * Somebody else's request is a 404, not a 403 — which service requests exist is not a fact this
     * API confirms to people who are not on them. The guard is the same one
     * {@code GET /service-requests/{id}} uses, deliberately: a checklist that leaked existence
     * would be a side door around it.
     */
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
                .andExpect(jsonPath("$.total").value(5));

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
}
