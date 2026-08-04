package com.punenest.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The assisted-service workflow, organised around the one property that matters:
 * <strong>the person who produces the draft is never the person who accepts it.</strong>
 *
 * <p>Everything else here — the transition table, the visibility rule, the status vocabulary —
 * exists to keep that true under pressure. The tests are grouped that way rather than
 * endpoint-by-endpoint, because a regression will break an invariant, not a URL.
 */
@DisplayName("Slice 11 — service requests: the maker-checker workflow")
class ServiceRequestFlowTest extends ServiceFixtures {

    @Nested
    @DisplayName("maker-checker integrity")
    class MakerChecker {

        @Test
        @DisplayName("staff cannot approve their own draft — not even an admin")
        void staffCannotDecide() throws Exception {
            User buyer = customer("9820000101");
            User desk = staff("9820000102", Teams.LEGAL);
            User boss = admin("9820000103");
            Property p = listing(buyer);
            String id = raise(buyer, "rent-agreement", p);

            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);

            decide(desk, id, "approve", 403);
            decide(boss, id, "approve", 403);
            expectStatus(desk, id, "draft-shared");

            decide(buyer, id, "approve", 200);
            expectStatus(buyer, id, "approved");
        }

        @Test
        @DisplayName("approved is unreachable through the status endpoint")
        void statusEndpointCannotApprove() throws Exception {
            User buyer = customer("9820000104");
            User desk = staff("9820000105", Teams.LEGAL);
            String id = raise(buyer, "legal-opinion", listing(buyer));

            setStatus(desk, id, "approved", 400);
            setStatus(desk, id, "completed", 400);
            setStatus(desk, id, "draft-shared", 400);
            expectStatus(desk, id, "new");
        }

        @Test
        @DisplayName("completed always has a registered document behind it")
        void completionRequiresTheFile() throws Exception {
            User buyer = customer("9820000106");
            User desk = staff("9820000107", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            // Nothing shared yet, so there is nothing to be approved and nothing to register.
            finalDoc(desk, id, 409);
            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            finalDoc(desk, id, 409);

            decide(buyer, id, "approve", 200);
            finalDoc(desk, id, 201);
            expectStatus(desk, id, "completed");
        }

        @Test
        @DisplayName("a rejected draft returns to in-progress, not to a dead end")
        void rejectionReopensTheWork() throws Exception {
            User buyer = customer("9820000108");
            User desk = staff("9820000109", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            decide(buyer, id, "reject", 200);
            expectStatus(desk, id, "in-progress");

            // and a revised draft is the same act done twice
            shareDraft(desk, id, 200);
            expectStatus(desk, id, "draft-shared");
            decide(buyer, id, "approve", 200);
            expectStatus(desk, id, "approved");
        }

        @Test
        @DisplayName("a customer cannot drive the workflow with the staff endpoints")
        void customerCannotUseStaffEndpoints() throws Exception {
            User buyer = customer("9820000110");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(buyer, id, "assigned", 403);
            shareDraft(buyer, id, 403);
            finalDoc(buyer, id, 403);
            expectStatus(buyer, id, "new");
        }

        @Test
        @DisplayName("there is nothing to decide until a draft is shared")
        void decisionNeedsADraft() throws Exception {
            User buyer = customer("9820000111");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            decide(buyer, id, "approve", 409);
            expectStatus(buyer, id, "new");
        }

        @Test
        @DisplayName("a decision must be approve or reject")
        void decisionVocabulary() throws Exception {
            User buyer = customer("9820000112");
            User desk = staff("9820000113", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);

            decide(buyer, id, "maybe", 400);
            expectStatus(buyer, id, "draft-shared");
        }
    }

    @Nested
    @DisplayName("the transition table")
    class Transitions {

        @Test
        @DisplayName("a cancelled request accepts no further work")
        void terminalIsTerminal() throws Exception {
            User buyer = customer("9820000114");
            User desk = staff("9820000115", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "cancelled", 200);
            setStatus(desk, id, "in-progress", 409);
            shareDraft(desk, id, 409);
            message(buyer, id, "are we still on?", 409);
        }

        @Test
        @DisplayName("an unknown status is a 400 naming the problem, not a 500 from the CHECK")
        void unknownStatusRejected() throws Exception {
            User buyer = customer("9820000116");
            User desk = staff("9820000117", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "registration", 400);
        }

        @Test
        @DisplayName("assigning takes the request for the staff member who assigned it")
        void assignmentIsAcknowledgement() throws Exception {
            User buyer = customer("9820000118");
            User desk = staff("9820000119", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "assigned", 200);
            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.assignee").value("Rohit Desk"));
        }
    }

    @Nested
    @DisplayName("visibility")
    class Visibility {

        @Test
        @DisplayName("a stranger's request is a 404, never a 403")
        void strangersRequestIsInvisible() throws Exception {
            User mine = customer("9820000120");
            User theirs = customer("9820000121");
            String id = raise(mine, "rent-agreement", listing(mine));

            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(theirs)))
                    .andExpect(status().isNotFound());
            message(theirs, id, "hello", 404);
        }

        @Test
        @DisplayName("the list is my own for a customer and the whole queue for ops")
        void listScopeFollowsTheRole() throws Exception {
            User mine = customer("9820000122");
            User theirs = customer("9820000123");
            User desk = staff("9820000124", Teams.LEGAL);
            raise(mine, "rent-agreement", listing(mine));
            raise(theirs, "legal-opinion", listing(theirs));

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].type").value("rent-agreement"));

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("type", "legal-opinion"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].type").value("legal-opinion"));
        }

        @Test
        @DisplayName("the list is paged and echoes the envelope")
        void listIsPaged() throws Exception {
            User buyer = customer("9820000125");
            raise(buyer, "rent-agreement", listing(buyer));

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .param("size", "5"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.page").value(0))
                    .andExpect(jsonPath("$.size").value(5))
                    .andExpect(jsonPath("$.totalElements").value(1));
        }

        @Test
        @DisplayName("an unknown status filter is a 400, not an empty page")
        void unknownFilterRejected() throws Exception {
            User buyer = customer("9820000126");

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .param("status", "docs_review"))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("a client-supplied sort cannot reach the query")
        void sortIsStripped() throws Exception {
            User buyer = customer("9820000127");

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .param("sort", "notAColumn,desc"))
                    .andExpect(status().isOk());
        }

        @Test
        @DisplayName("anonymous callers get nothing")
        void anonymousRejected() throws Exception {
            mvc.perform(get(Routes.ServiceRequests.BASE))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Nested
    @DisplayName("the conversation and the timeline")
    class Conversation {

        @Test
        @DisplayName("the author's role is taken from the token, not the body")
        void authorRoleIsServerResolved() throws Exception {
            User buyer = customer("9820000128");
            User desk = staff("9820000129", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            message(buyer, id, "when will the draft be ready?", 201);
            message(desk, id, "by Friday", 201);

            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.messages", hasSize(2)))
                    .andExpect(jsonPath("$.messages[0].authorRole").value("buyer"))
                    .andExpect(jsonPath("$.messages[1].authorRole").value("staff"));
        }

        @Test
        @DisplayName("the timeline narrates every transition, oldest first")
        void timelineNarratesTheWorkflow() throws Exception {
            User buyer = customer("9820000130");
            User desk = staff("9820000131", Teams.LEGAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            decide(buyer, id, "approve", 200);

            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.timeline[0].event").value("request.created"))
                    .andExpect(jsonPath("$.timeline[1].event").value("status.assigned"))
                    .andExpect(jsonPath("$.timeline[2].event").value("draft.shared"))
                    .andExpect(jsonPath("$.timeline[3].event").value("draft.approved"))
                    .andExpect(jsonPath("$.timeline[3].by").value("Asha Patil"));
        }

        @Test
        @DisplayName("an empty message body is rejected")
        void emptyMessageRejected() throws Exception {
            User buyer = customer("9820000132");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            message(buyer, id, "", 422);
        }
    }

    @Nested
    @DisplayName("creation")
    class Creation {

        @Test
        @DisplayName("the requester is the caller, and the status is always new")
        void createIgnoresClientClaims() throws Exception {
            User buyer = customer("9820000133");
            Property p = listing(buyer);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"status\":\"approved\","
                                    + "\"propertyId\":\"" + p.getId() + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("new"))
                    .andExpect(jsonPath("$.propertyId").value(p.getId().toString()));
        }

        @Test
        @DisplayName("a type is required")
        void typeRequired() throws Exception {
            User buyer = customer("9820000134");

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"details\":\"something\"}"))
                    .andExpect(status().isUnprocessableEntity());
        }

        @Test
        @DisplayName("a malformed propertyId is a 400, not a silent null")
        void malformedPropertyIdRejected() throws Exception {
            User buyer = customer("9820000135");

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"propertyId\":\"not-a-uuid\"}"))
                    .andExpect(status().isBadRequest());
        }
    }

    private void message(User caller, String id, String body, int expected) throws Exception {
        mvc.perform(post(Routes.ServiceRequests.MESSAGES, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"" + body + "\"}"))
                .andExpect(status().is(expected));
    }
}
