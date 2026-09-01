package com.punenest.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import com.punenest.api.services.request.CoFillInviteRetention;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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

    /** Driven directly rather than through its scheduler, which is off in tests. */
    @Autowired
    private CoFillInviteRetention retention;

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
        @DisplayName("a rejected draft lands in changes-requested, not back in the general pool")
        void rejectionReopensTheWork() throws Exception {
            User buyer = customer("9820000108");
            User desk = staff("9820000109", Teams.RENTAL);
            String id = raise(buyer, "rent-agreement", listing(buyer));

            setStatus(desk, id, "assigned", 200);
            shareDraft(desk, id, 200);
            decide(buyer, id, "reject", 200);
            // D121. This used to read "in-progress" — the same state a request that had never been
            // rejected also sits in, which made a rejection unrecoverable from the read shape: the
            // operator saw ordinary work in flight and nothing said the draft had been refused.
            expectStatus(desk, id, "changes-requested");

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
            User desk = staff("9820000113", Teams.RENTAL);
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
            decide(buyer, id, "approve", 200);

            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.timeline[0].event").value("request.created"))
                    .andExpect(jsonPath("$.timeline[1].event").value("payment.pending"))
                    .andExpect(jsonPath("$.timeline[2].event").value("payment.received"))
                    .andExpect(jsonPath("$.timeline[3].event").value("status.assigned"))
                    .andExpect(jsonPath("$.timeline[4].event").value("draft.shared"))
                    .andExpect(jsonPath("$.timeline[5].event").value("draft.approved"))
                    .andExpect(jsonPath("$.timeline[5].by").value("Asha Patil"));
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
                    // A free desk carries no charge and no checkout session.
                    .andExpect(jsonPath("$.amount").doesNotExist())
                    .andExpect(jsonPath("$.paymentSessionId").doesNotExist())
                    // D119: the structured details the form sent are echoed back, not write-only.
                    .andExpect(jsonPath("$.details.property").value("Aundh, Pune"))
                    .andExpect(jsonPath("$.details.rent").value(25000));
        }

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

        @Test
        @DisplayName("an oversized details object is a 400 (D119: the bound the old string cap had)")
        void oversizedDetailsRejected() throws Exception {
            User buyer = customer("9820000136");
            // Comfortably past DETAILS_MAX_CHARS, which D157 raised from 8000 to 16000 after the
            // wizard's worst realistic state was measured at 7875 characters. Sized as a multiple
            // of the cap rather than as a literal so it stays oversized if the cap moves again.
            String huge = "x".repeat(20000);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"details\":{\"note\":\"" + huge + "\"}}"))
                    .andExpect(status().isBadRequest());
        }

        /**
         * The pricing table is keyed by an exact type string, so before the allowlist a caller who
         * asked for {@code "rent agreement"}, {@code "rental"} or {@code "Rent-Agreement"} got the
         * whole rent-agreement desk free of charge and straight into the ops queue: the payment gate
         * was opt-in by spelling. The queue's own filter is the second victim — an unrecognised desk
         * name lands in a queue no team is watching.
         */
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

        /**
         * {@code details} is plaintext jsonb echoed on every read, including the paged ops queue, so
         * a PAN or an Aadhaar in it is a bulk identity dump waiting for the first staff login. The
         * wizard redacts client-side; this is the server refusing to be the place a future call site
         * can forget.
         */
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

            // Spelt around: an exact-name list would have waved all of these through, and this is the
            // backstop for a client-side redaction some future call site forgets to apply.
            for (String key : new String[] {"panNo", "pan_number", "aadhaarNumber", "tenant-pan"}) {
                mvc.perform(post(Routes.ServiceRequests.BASE)
                                .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"type\":\"legal\",\"details\":{\"owner\":{\"" + key + "\":\"ABCDE1234F\"}}}"))
                        .andExpect(status().isBadRequest());
            }

            // A *blank* identity field is the shape the wizard actually posts: it keeps the keys and
            // empties them, because its form state is restored slice-by-slice and a missing key makes
            // a controlled input uncontrolled. An empty string discloses nothing, so refusing it would
            // have rejected every well-behaved submission and let only the malformed ones through.
            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"details\":{\"_state\":{\"owner\":{\"oName\":\"Asha\","
                                    + "\"oPan\":\"\",\"oAadhaar\":\"\"},\"tenants\":[{\"name\":\"Rahul\","
                                    + "\"pan\":\"\",\"aadhaar\":\"\"}]}}}"))
                    .andExpect(status().isCreated());

            // The legitimate shape still passes -- this is a key ban, not a details ban.
            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"details\":{\"owner\":{\"oName\":\"Asha\"}}}"))
                    .andExpect(status().isCreated());
        }

        /**
         * D162. V42 preserved each rewritten row's pre-migration {@code type} inside {@code details}
         * — the customer's own form state — so an internal audit marker started coming back out on a
         * customer-facing read. Planted through the API here rather than through the migration,
         * because the mapper only ever sees a map: where the key came from is precisely what it
         * cannot tell, and a client that plants one must not be able to make a staff reader believe
         * a row was relabelled either.
         *
         * <p>{@code _state} is asserted on the same response deliberately. It shares the leading
         * underscore and nothing else: it is the rent-agreement wizard's own form snapshot, the
         * invited tenant resumes from it and the drafting desk reads the agreement out of it. The
         * obvious generalisation of this fix — strip every {@code _}-prefixed key — would have
         * deleted it from both, and this assertion is what stops someone making that change later.
         */
        @Test
        @DisplayName("V42's migration markers are stripped from details; _state is not")
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
        @DisplayName("a rent agreement is created awaiting-payment, priced, with a checkout session")
        void createdAwaitingPayment() throws Exception {
            User buyer = customer("9820000140");
            Property p = listing(buyer);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"rent-agreement\",\"propertyId\":\"" + p.getId() + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("awaiting-payment"))
                    // Seeded rent row: platform fee 1999 + GST 360. This body states no terms, so
                    // there is no consideration to tax and no statutory charge is invented (D163) —
                    // ServiceRequestRentPricingTest covers the request that does state them.
                    .andExpect(jsonPath("$.amount").value(2359))
                    .andExpect(jsonPath("$.paymentSessionId").isNotEmpty());
        }

        @Test
        @DisplayName("ops does not see it until the payment settles, then it enters the queue at new")
        void invisibleToTheQueueUntilPaid() throws Exception {
            User buyer = customer("9820000141");
            User desk = staff("9820000142", Teams.RENTAL);
            String id = raiseUnpaid(buyer, listing(buyer));

            // The unpaid request is the customer's, at awaiting-payment...
            expectStatus(buyer, id, "awaiting-payment");
            // ...but the ops queue does not show it.
            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id=='" + id + "')]", hasSize(0)));

            // The signed payment callback settles it, and it enters the queue at new.
            deliverSigned(paymentRef(id), true);
            expectStatus(buyer, id, "new");
            mvc.perform(get(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id=='" + id + "')]", hasSize(1)));
        }

        @Test
        @DisplayName("a failed payment cancels the request")
        void failedPaymentCancels() throws Exception {
            User buyer = customer("9820000143");
            String id = raiseUnpaid(buyer, listing(buyer));

            deliverSigned(paymentRef(id), false);
            expectStatus(buyer, id, "cancelled");
        }

        /**
         * Creating a priced request opens a gateway order, so an unauthenticated-cost loop was one
         * {@code for} loop away from a caller with a valid token: thousands of orders at the merchant
         * account and thousands of rows nobody will ever pay for. One outstanding order per desk is
         * the natural cap because a second one is never a legitimate intent -- you cannot register
         * two agreements for the same tenancy at once -- and the escape hatch already exists.
         *
         * <p>This is a cap on <em>outstanding</em> orders, not a rate limit: pay or cancel, and the
         * next one is allowed immediately. Blanket rate limiting on authenticated writes is D2.
         */
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

            // A free desk is unaffected -- it opens no order, so there is nothing to cap.
            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"type\":\"legal\",\"propertyId\":\"" + p.getId() + "\"}"))
                    .andExpect(status().isCreated());

            // Settling the first releases the cap.
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
            @DisplayName("co-fill defers checkout, then opens it after invite acceptance")
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
                            + p.getId() + "\",\"details\":{\"property\":\"Flat 9A\"}},"
                            + "\"role\":\"tenant\",\"mobile\":\"" + tenant.getMobile()
                            + "\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("awaiting-payment"))
                    .andExpect(jsonPath("$.paymentSessionId").doesNotExist())
                    .andReturn().getResponse().getContentAsString();
                String requestId = field(created, "id");

                // Unpaid is still invisible to ops, as with any awaiting-payment request.
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
                        .content("{\"details\":{\"tenants\":\"Ria Sharma\",\"_state\":{\"tenantMode\":\"fill\"}}}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.details.tenants").value("Ria Sharma"));

                mvc.perform(post(Routes.ServiceRequests.CHECKOUT, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.paymentSessionId").isNotEmpty());
            }

            @Test
            @DisplayName("co-fill invite to an unregistered mobile waits, then binds on sign-up")
            void coFillPendingInviteIsClaimedOnSignUp() throws Exception {
                User owner = customer("9820000152");
                Property p = listing(owner);

                // The number belongs to nobody yet. V75 refused this outright; V107 holds the
                // number instead, which is the whole point — the requester should not have to ring
                // the other party and talk them through a sign-up before they can start.
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

                // The requester can see who they invited, masked. Masked and not plain: they typed
                // the number, so this tells them nothing they did not already know, and an API that
                // echoes whole mobiles back is one API bug away from being a directory.
                mvc.perform(get(Routes.ServiceRequests.BY_ID, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.parties", hasSize(1)))
                    .andExpect(jsonPath("$.parties[0].pending").value(true))
                    .andExpect(jsonPath("$.parties[0].status").value("invited"))
                    .andExpect(jsonPath("$.parties[0].mobile").value("98XXXXX999"));

                // They sign up. Nothing in registration knows about service requests -- identity
                // sits below services in the module order and there is no event bus -- so the
                // binding happens the first time they look at their invitations.
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

                // And the row no longer holds a number: claimed rows are byte-for-byte the rows
                // V75 described, which is what keeps this table's steady state free of contact data.
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

                // A stranger gets 404, not 403: whether this request exists is not their business.
                mvc.perform(delete(Routes.ServiceRequests.PARTY_BY_ID, requestId, partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                    .andExpect(status().isNotFound());

                mvc.perform(delete(Routes.ServiceRequests.PARTY_BY_ID, requestId, partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isNoContent());

                // A mistyped number is the whole reason this route exists, so the role has to be
                // genuinely free afterwards -- not merely marked withdrawn under the unique index.
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

                // A number that was never claimed is a number that may since have been recycled to
                // somebody with no connection to this agreement, which is the answer to the second
                // of V75's two objections and the reason the retention window exists at all.
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
