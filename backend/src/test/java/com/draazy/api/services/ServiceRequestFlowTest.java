package com.draazy.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.common.web.Routes;
import com.draazy.api.engagement.notification.NotificationRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.services.request.CoFillInviteRetention;
import com.draazy.api.services.request.ServiceRequestEventRepository;
import com.draazy.api.services.request.ServiceRequestMessageRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

// The assisted-service workflow, organised around the one property that matters: whoever produces the draft never
// accepts it.
@DisplayName("Slice 11 — service requests: the maker-checker workflow")
class ServiceRequestFlowTest extends ServiceFixtures {

    @Autowired
    private CoFillInviteRetention retention;

    @Autowired
    private ServiceRequestMessageRepository messages;

    @Autowired
    private NotificationRepository notifications;

    @Autowired
    private ServiceRequestEventRepository events;

    @Nested
    @DisplayName("maker-checker integrity")
    class MakerChecker {

        @Test
        @DisplayName("staff cannot approve their own draft — not even an admin")
        void staffCannotDecide() throws Exception {
            User buyer = customer("9820000101");
            User desk = staff("9820000102", Teams.RENTAL);
            User boss = admin("9820000103");
            Property p = listing(buyer);
            String id = raise(buyer, "rent-agreement", p);

            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);

            decide(desk, id, "approve", 403);
            decide(boss, id, "approve", 403);
            expectStatus(desk, id, "draft-shared");

            openDraft(buyer, id, 204);
            decide(buyer, id, "approve", 200);
            expectStatus(buyer, id, "approved");
        }

        @Test
        @DisplayName("approved is unreachable through the status endpoint")
        void statusEndpointCannotApprove() throws Exception {
            User buyer = customer("9820000104");
            User desk = staff("9820000105", Teams.LEGAL);
            String id = raise(buyer, "legal", listing(buyer));

            setStatus(desk, id, "approved", 400);
            setStatus(desk, id, "completed", 400);
            setStatus(desk, id, "draft-shared", 400);
            expectStatus(desk, id, "new");
        }

        @Test
        @DisplayName("completed always has a registered document behind it")
        void completionRequiresTheFile() throws Exception {
            User buyer = customer("9820000106");
            User desk = staff("9820000107", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            finalDoc(desk, id, 409);
            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            finalDoc(desk, id, 409);

            openDraft(buyer, id, 204);
            decide(buyer, id, "approve", 200);
            finalDoc(desk, id, 201);
            expectStatus(desk, id, "completed");
        }

        @Test
        @DisplayName("a rejected draft lands in changes-requested, not back in the general pool")
        void rejectionReopensTheWork() throws Exception {
            User buyer = customer("9820000108");
            User desk = staff("9820000109", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            decide(buyer, id, "reject", 400);
            reject(buyer, id, "   ", 400);
            expectStatus(desk, id, "draft-shared");
            reject(buyer, id, "Clause 7 names the wrong flat", 200);
            expectStatus(desk, id, "changes-requested");

            shareDraft(desk, id, 200);
            expectStatus(desk, id, "draft-shared");
            openDraft(buyer, id, 204);
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
            User desk = staff("9820000113", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);

            decide(buyer, id, "maybe", 400);
            expectStatus(buyer, id, "draft-shared");
        }

        @Test
        @DisplayName("the requester approves only a draft they opened, and a revised draft must be opened again")
        void approvalFollowsOpeningTheDraft() throws Exception {
            User buyer = customer("9820000170");
            User desk = staff("9820000171", Teams.RENTAL);
            User stranger = customer("9820000172");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            openDraft(buyer, id, 409);
            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            decide(buyer, id, "approve", 409);

            openDraft(stranger, id, 404);
            openDraft(desk, id, 204);
            decide(buyer, id, "approve", 409);

            openDraft(buyer, id, 204);
            reject(buyer, id, "Rent in clause 3 is wrong", 200);
            shareDraft(desk, id, 200);
            decide(buyer, id, "approve", 409);

            openDraft(buyer, id, 204);
            openDraft(buyer, id, 204);
            decide(buyer, id, "approve", 200);
            assertThat(events.findByRequestIdOrderByAtAsc(UUID.fromString(id)))
                .filteredOn(e -> "draft.opened".equals(e.getEvent()))
                .hasSize(2);
        }
    }

    @Nested
    @DisplayName("the transition table")
    class Transitions {

        @Test
        @DisplayName("cancelling requires a reason the customer receives in the thread and inbox")
        void cancellationIsExplainedToTheCustomer() throws Exception {
            User buyer = customer("9820000135");
            User desk = staff("9820000136", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            mvc.perform(patch(Routes.ServiceRequests.STATUS, id)
                    .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"status\":\"cancelled\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[*].message", hasSize(1)));

            mvc.perform(patch(Routes.ServiceRequests.STATUS, id)
                    .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"status\":\"cancelled\",\"note\":\"The owner withdrew consent\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("cancelled"));

            assertThat(messages.findByRequestIdOrderByCreatedAtAsc(UUID.fromString(id)))
                .extracting(message -> message.getBody())
                .contains("The owner withdrew consent");
            assertThat(notifications.findAll())
                .anySatisfy(notification -> {
                    assertThat(notification.getUserId()).isEqualTo(buyer.getId());
                    assertThat(notification.getType()).isEqualTo("service.cancelled");
                    assertThat(notification.getBody()).contains("The owner withdrew consent");
                });
        }

        @Test
        @DisplayName("starting work on an unheld request takes it, so an approved request always has a holder")
        void startingWorkTakesTheRequest() throws Exception {
            User buyer = customer("9820000160");
            User desk = staff("9820000161", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "in-progress", 200);
            shareDraft(desk, id, 200);
            openDraft(buyer, id, 204);
            decide(buyer, id, "approve", 200);
            finalDoc(desk, id, 201);
        }

        @Test
        @DisplayName("only the operator holding the request shares its draft or moves it on")
        void onlyTheHolderSharesTheDraft() throws Exception {
            User buyer = customer("9820000162");
            User holder = user("9820000163", Roles.Wire.STAFF, Teams.RENTAL, "Meera Holder");
            User colleague = staff("9820000164", Teams.RENTAL);
            User boss = admin("9820000165");
            String id = raise(buyer, "rent-agreement", listing(buyer));
            setStatus(holder, id, "assigned", 200);

            mvc.perform(multipart(Routes.ServiceRequests.DRAFT, id)
                            .file(new MockMultipartFile("file", "draft.pdf", "application/pdf",
                                    "%PDF-1.4 draft".getBytes()))
                            .header(HttpHeaders.AUTHORIZATION, bearer(colleague)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message").value(containsString("Meera Holder")));
            setStatus(colleague, id, "in-progress", 409);
            expectStatus(holder, id, "assigned");

            shareDraft(boss, id, 200);
            shareDraft(holder, id, 200);
        }

        @Test
        @DisplayName("staff cannot take a colleague's in-progress request, but an admin can")
        void staffCannotSeizeButAdminCanReassign() throws Exception {
            User buyer = customer("9820000137");
            User firstDesk = user("9820000138", Roles.Wire.STAFF, Teams.RENTAL, "Meera Holder");
            User secondDesk = staff("9820000139", Teams.RENTAL);
            User boss = admin("9820000140");
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(firstDesk, id, "assigned", 200);
            setStatus(firstDesk, id, "in-progress", 200);

            mvc.perform(patch(Routes.ServiceRequests.STATUS, id)
                    .header(HttpHeaders.AUTHORIZATION, bearer(secondDesk))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"status\":\"assigned\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(containsString("Meera Holder")));

            mvc.perform(patch(Routes.ServiceRequests.STATUS, id)
                    .header(HttpHeaders.AUTHORIZATION, bearer(boss))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"status\":\"assigned\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignee").value("Admin User"));
        }

        @Test
        @DisplayName("a cancelled request accepts no further work")
        void terminalIsTerminal() throws Exception {
            User buyer = customer("9820000114");
            User desk = staff("9820000115", Teams.RENTAL);
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
            User desk = staff("9820000117", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "registration", 400);
        }

        @Test
        @DisplayName("assigning takes the request for the staff member who assigned it")
        void assignmentIsAcknowledgement() throws Exception {
            User buyer = customer("9820000118");
            User desk = staff("9820000119", Teams.RENTAL);
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
            raise(theirs, "legal", listing(theirs));

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(mine)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].type").value("rent-agreement"));

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("type", "legal"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].type").value("legal"));
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
        @DisplayName("ops can triage unassigned work and find a requester without wildcarding the queue")
        void queueCanFilterUnassignedAndSearchTheRequester() throws Exception {
            User matchingBuyer = user("9820000142", Roles.Wire.BUYER, null, "Anaya Deshmukh");
            User otherBuyer = customer("9820000143");
            User desk = staff("9820000144", Teams.RENTAL);
            String assigned = raise(matchingBuyer, "rent-agreement", listing(matchingBuyer));
            String unassigned = raise(otherBuyer, "rent-agreement", listing(otherBuyer));
            setStatus(desk, assigned, "assigned", 200);

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("unassigned", "true"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(1)))
                    .andExpect(jsonPath("$.content[0].id").value(unassigned));

            for (String q : new String[] {"Anaya", matchingBuyer.getMobile(), assigned}) {
                mvc.perform(get(Routes.ServiceRequests.BASE)
                                .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                                .param("q", q))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.content", hasSize(1)))
                        .andExpect(jsonPath("$.content[0].id").value(assigned));
            }

            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk))
                            .param("q", "%"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", hasSize(0)));
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
            User desk = staff("9820000129", Teams.RENTAL);
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
            User desk = staff("9820000131", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));
            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            openDraft(buyer, id, 204);
            decide(buyer, id, "approve", 200);

            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.timeline[0].event").value("request.created"))
                    .andExpect(jsonPath("$.timeline[1].event").value("payment.pending"))
                    .andExpect(jsonPath("$.timeline[2].event").value("payment.received"))
                    .andExpect(jsonPath("$.timeline[3].event").value("status.assigned"))
                    .andExpect(jsonPath("$.timeline[4].event").value("draft.shared"))
                    .andExpect(jsonPath("$.timeline[5].event").value("draft.opened"))
                    .andExpect(jsonPath("$.timeline[5].by").value("Asha Patil"))
                    .andExpect(jsonPath("$.timeline[6].event").value("draft.approved"))
                    .andExpect(jsonPath("$.timeline[6].by").value("Asha Patil"));
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
        @DisplayName("the requester is the caller, and a free desk starts at new whatever the client claims")
        void createIgnoresClientClaims() throws Exception {
            User buyer = customer("9820000133");
            Property p = listing(buyer);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"status\":\"approved\","
                                    + "\"propertyId\":\"" + p.getId() + "\","
                                    + "\"details\":{\"property\":\"Aundh, Pune\",\"rent\":25000}}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("new"))
                    .andExpect(jsonPath("$.propertyId").value(p.getId().toString()))
                    .andExpect(jsonPath("$.amount").doesNotExist())
                    .andExpect(jsonPath("$.paymentSessionId").doesNotExist())
                    .andExpect(jsonPath("$.details.property").value("Aundh, Pune"))
                    .andExpect(jsonPath("$.details.rent").value(25000));
        }

        // Planted through the API here rather than through the migration, because the mapper only ever sees a map: where
        // `_state` is asserted on the same response deliberately.
        @Test
        @DisplayName("a type is required")
        void typeRequired() throws Exception {
            User buyer = customer("9820000134");

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"details\":{\"note\":\"something\"}}"))
                    .andExpect(status().isUnprocessableEntity());
        }

        // Creating a priced request opens a gateway order, so one outstanding order per desk caps an otherwise
        // unbounded cost loop.
        @Test
        @DisplayName("a malformed propertyId is a 400, not a silent null")
        void malformedPropertyIdRejected() throws Exception {
            User buyer = customer("9820000135");

            // A free desk is unaffected -- it opens no order, so there is nothing to cap.
            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"propertyId\":\"not-a-uuid\"}"))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("an oversized details object is a 400")
        void oversizedDetailsRejected() throws Exception {
            User buyer = customer("9820000136");

            String huge = "x".repeat(20000);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"details\":{\"note\":\"" + huge + "\"}}"))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("an unrecognised type is a 400, not a free desk (the price bypass)")
        void unknownTypeRejected() throws Exception {
            User buyer = customer("9820000137");
            Property p = listing(buyer);

            for (String spelling : new String[] {"rental", "Rent-Agreement", "rent agreement", "vip"}) {
                mvc.perform(post(Routes.ServiceRequests.BASE)
                                .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"type\":\"" + spelling + "\",\"propertyId\":\"" + p.getId() + "\"}"))
                        .andExpect(status().isBadRequest());
            }
        }

        @Test
        @DisplayName("an identity number anywhere in details is a 400, at any nesting depth")
        void identityNumbersInDetailsRejected() throws Exception {
            User buyer = customer("9820000138");

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"details\":{\"owner\":{\"oPan\":\"ABCDE1234F\"}}}"))
                    .andExpect(status().isBadRequest());

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"details\":{\"tenants\":[{\"aadhaar\":\"111122223333\"}]}}"))
                    .andExpect(status().isBadRequest());

            for (String key : new String[] {"panNo", "pan_number", "aadhaarNumber", "tenant-pan"}) {
                mvc.perform(post(Routes.ServiceRequests.BASE)
                                .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"type\":\"legal\",\"details\":{\"owner\":{\"" + key + "\":\"ABCDE1234F\"}}}"))
                        .andExpect(status().isBadRequest());
            }

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"details\":{\"_state\":{\"owner\":{\"oName\":\"Asha\","
                                    + "\"oPan\":\"\",\"oAadhaar\":\"\"},\"tenants\":[{\"name\":\"Rahul\","
                                    + "\"pan\":\"\",\"aadhaar\":\"\"}]}}}"))
                    .andExpect(status().isCreated());

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"details\":{\"owner\":{\"oName\":\"Asha\"}}}"))
                    .andExpect(status().isCreated());
        }

        @Test
        @DisplayName("migration markers are stripped from details; _state is not")
        void migrationMarkersAreNotEchoed() throws Exception {
            User buyer = customer("9820000139");

            String created = mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"details\":{\"property\":\"Flat 4B, Baner\","
                                    + "\"_state\":{\"owner\":{\"oName\":\"Asha\"}},"
                                    + "\"_migratedFromType\":\"rental\",\"_migratedDetails\":\"legacy\"}}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.details._migratedFromType").doesNotExist())
                    .andReturn().getResponse().getContentAsString();

            mvc.perform(get(Routes.ServiceRequests.BY_ID, field(created, "id"))
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.details._migratedFromType").doesNotExist())
                    .andExpect(jsonPath("$.details._migratedDetails").doesNotExist())
                    .andExpect(jsonPath("$.details.property").value("Flat 4B, Baner"))
                    .andExpect(jsonPath("$.details._state.owner.oName").value("Asha"));
        }
    }

    @Nested
    @DisplayName("the paid gate on a rent agreement")
    class PaidGate {

        @Test
        @DisplayName("a rent agreement is created awaiting-payment and priced, with checkout left for later")
        void createdAwaitingPayment() throws Exception {
            User buyer = customer("9820000140");
            Property p = listing(buyer);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("awaiting-payment"))

                    .andExpect(jsonPath("$.amount").value(590))
                    .andExpect(jsonPath("$.paymentSessionId").doesNotExist());
        }

        @Test
        @DisplayName("ops does not see it until the payment settles, then it enters the queue at new")
        void invisibleToTheQueueUntilPaid() throws Exception {
            User buyer = customer("9820000141");
            User desk = staff("9820000142", Teams.RENTAL);
            String id = raiseUnpaid(buyer, listing(buyer));

            expectStatus(buyer, id, "awaiting-payment");
            mvc.perform(post(Routes.ServiceRequests.CHECKOUT, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"declaration\":\"ra-decl-2026-09\"}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", containsString("Upload required documents before checkout")));
            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id=='" + id + "')]", hasSize(0)));

            deliverSigned(paymentRef(id), true);
            expectStatus(buyer, id, "new");
            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id=='" + id + "')]", hasSize(1)));
        }

        @Test
        @DisplayName("local simulation is requester-only and mock-order-only")
        void localPaymentSimulation() throws Exception {
            User buyer = customer("9820000145");
            User stranger = customer("9820000146");
            String id = raiseUnpaid(buyer, listing(buyer));
            paymentRef(id);
            String route = Routes.ServiceRequests.PAYMENT_SIMULATE.replace("{id}", id);

            mvc.perform(post(route).param("outcome", "paid")
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                    .andExpect(status().isForbidden());

            jdbc.update("update service_requests set payment_ref = 'dz_real_order' where id = ?",
                    UUID.fromString(id));
            em.clear();
            mvc.perform(post(route).param("outcome", "paid")
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isConflict());

            User payer = customer("9820000147");
            String mockId = raiseUnpaid(payer, listing(payer));
            paymentRef(mockId);
            mvc.perform(post(Routes.ServiceRequests.PAYMENT_SIMULATE.replace("{id}", mockId))
                            .param("outcome", "paid")
                            .header(HttpHeaders.AUTHORIZATION, bearer(payer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("new"));
        }

        @Test
        @DisplayName("a failed payment cancels the request")
        void failedPaymentCancels() throws Exception {
            User buyer = customer("9820000143");
            String id = raiseUnpaid(buyer, listing(buyer));

            deliverSigned(paymentRef(id), false);
            expectStatus(buyer, id, "cancelled");
        }

        @Test
        @DisplayName("a second unpaid request for the same desk is a 409 until the first is settled")
        void oneOutstandingUnpaidOrderPerDesk() throws Exception {
            User buyer = customer("9820000148");
            Property p = listing(buyer);
            String first = raiseUnpaid(buyer, p);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\"}"))
                    .andExpect(status().isConflict());

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"propertyId\":\"" + p.getId() + "\"}"))
                    .andExpect(status().isCreated());

            deliverSigned(paymentRef(first), true);
            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\"}"))
                    .andExpect(status().isCreated());
        }

        @Test
        @DisplayName("a redelivered callback does not move an already-settled request")
        void settlementIsIdempotent() throws Exception {
            User buyer = customer("9820000144");
            String id = raiseUnpaid(buyer, listing(buyer));
            String ref = paymentRef(id);

            deliverSigned(ref, true);
            expectStatus(buyer, id, "new");

            // Cashfree may redeliver; a second success must not disturb a request now in the queue.
            deliverSigned(ref, false);
            expectStatus(buyer, id, "new");
        }

            @Test
            @DisplayName("co-fill defers checkout, which stays shut after acceptance until the papers are in")
            void coFillDeferredCheckout() throws Exception {
                User owner = customer("9820000149");
                User tenant = customer("9820000150");
                User desk = staff("9820000151", Teams.RENTAL);
                Property p = listing(owner);

                String created = mvc.perform(post(Routes.ServiceRequests.CO_FILL_CREATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{" +
                            "\"request\":{\"type\":\"rent-agreement\",\"propertyId\":\""
                            + p.getId() + "\",\"details\":{\"property\":\"Flat 9A\","
                            + "\"_state\":{\"owner\":{\"oMobile\":\"" + owner.getMobile()
                            + "\"},\"terms\":{\"months\":\"11\"}}}},"
                            + "\"role\":\"tenant\",\"mobile\":\"" + tenant.getMobile()
                            + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("awaiting-payment"))
                    .andExpect(jsonPath("$.paymentSessionId").doesNotExist())
                    .andReturn().getResponse().getContentAsString();
                String requestId = field(created, "id");

                mvc.perform(get(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id=='" + requestId + "')]", hasSize(0)));

                String invites = mvc.perform(get(Routes.ServiceRequests.MY_INVITES)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", hasSize(1)))
                    .andReturn().getResponse().getContentAsString();
                String partyId = field(invites, "id");

                mvc.perform(post(Routes.ServiceRequests.INVITE_DECISION, partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"accept\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("accepted"));

                mvc.perform(put(Routes.ServiceRequests.PARTY_DETAILS, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"details\":{\"tenants\":\"Ria Sharma\",\"_state\":{\"tenantMode\":\"fill\","
                                + "\"tenants\":[{\"name\":\"Ria Sharma\"}]}}}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.details.tenants").value("Ria Sharma"))
                    .andExpect(jsonPath("$.details._state.owner.oMobile").value(owner.getMobile()))
                    .andExpect(jsonPath("$.details._state.tenants[0].name").value("Ria Sharma"));

                mvc.perform(post(Routes.ServiceRequests.CHECKOUT, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message").value(
                            org.hamcrest.Matchers.containsString("Upload required documents before checkout")));
            }

            @Test
            @DisplayName("co-fill invite to an unregistered mobile waits, then binds on sign-up")
            void coFillPendingInviteIsClaimedOnSignUp() throws Exception {
                User owner = customer("9820000152");
                Property p = listing(owner);

                String created = mvc.perform(post(Routes.ServiceRequests.CO_FILL_CREATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{" +
                            "\"request\":{\"type\":\"rent-agreement\",\"propertyId\":\""
                            + p.getId() + "\"},"
                            + "\"role\":\"tenant\",\"mobile\":\"9820000999\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
                String requestId = field(created, "id");

                // Masked and not plain: they typed the number, so this tells them nothing they did not already know,
                // and an API that echoes whole mobiles back is one API bug away from being a directory.
                mvc.perform(get(Routes.ServiceRequests.BY_ID, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.parties", hasSize(1)))
                    .andExpect(jsonPath("$.parties[0].pending").value(true))
                    .andExpect(jsonPath("$.parties[0].status").value("invited"))
                    .andExpect(jsonPath("$.parties[0].mobile").value("98XXXXX999"));

                User tenant = customer("9820000999");
                String invites = mvc.perform(get(Routes.ServiceRequests.MY_INVITES)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", hasSize(1)))
                    .andExpect(jsonPath("$[0].pending").value(false))
                    .andExpect(jsonPath("$[0].mobile").doesNotExist())
                    .andReturn().getResponse().getContentAsString();

                // Claiming is not accepting. The invitation is now addressed to a person and still
                // unanswered, which is why checkout must stay shut.
                mvc.perform(post(Routes.ServiceRequests.CHECKOUT, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isConflict());

                mvc.perform(post(Routes.ServiceRequests.INVITE_DECISION, field(invites, "id"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"accept\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("accepted"));

                mvc.perform(get(Routes.ServiceRequests.BY_ID, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.parties[0].pending").value(false))
                    .andExpect(jsonPath("$.parties[0].mobile").doesNotExist());
            }

            @Test
            @DisplayName("the requester can withdraw a pending invite and re-issue the role")
            void withdrawingAPendingInviteFreesTheRole() throws Exception {
                User owner = customer("9820000153");
                User stranger = customer("9820000154");
                Property p = listing(owner);

                String created = mvc.perform(post(Routes.ServiceRequests.CO_FILL_CREATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{" +
                            "\"request\":{\"type\":\"rent-agreement\",\"propertyId\":\""
                            + p.getId() + "\"},"
                            + "\"role\":\"tenant\",\"mobile\":\"9820000998\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
                String requestId = field(created, "id");
                String partyId = field(created.substring(created.indexOf("\"parties\":[")), "id");

                mvc.perform(delete(Routes.ServiceRequests.PARTY_BY_ID, requestId, partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                    .andExpect(status().isNotFound());

                mvc.perform(delete(Routes.ServiceRequests.PARTY_BY_ID, requestId, partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isNoContent());

                mvc.perform(post(Routes.ServiceRequests.PARTIES, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"tenant\",\"mobile\":\"9820000997\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.pending").value(true))
                    .andExpect(jsonPath("$.mobile").value("98XXXXX997"));
            }

            @Test
            @DisplayName("an unclaimed invite is deleted once it expires")
            void unclaimedInvitesExpire() throws Exception {
                User owner = customer("9820000155");
                Property p = listing(owner);

                mvc.perform(post(Routes.ServiceRequests.CO_FILL_CREATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{" +
                            "\"request\":{\"type\":\"rent-agreement\",\"propertyId\":\""
                            + p.getId() + "\"},"
                            + "\"role\":\"tenant\",\"mobile\":\"9820000996\"}"))
                    .andExpect(status().isCreated());

                // Nothing is due yet -- the sweep must not take a live invitation with it.
                assertThat(retention.expireNow()).isZero();

                long swept = retention.expireInvitesOlderThan(
                        Instant.now().plus(CoFillInviteRetention.RETENTION).plusSeconds(60));
                assertThat(swept).isEqualTo(1);

                User late = customer("9820000996");
                mvc.perform(get(Routes.ServiceRequests.MY_INVITES)
                        .header(HttpHeaders.AUTHORIZATION, bearer(late)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$", hasSize(0)));
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
