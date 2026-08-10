package com.punenest.api.services;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import com.punenest.api.services.request.ServiceRequestStatuses;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The way out of {@code awaiting-payment}, and the floor under the cap that guards it — D152 and
 * D153.
 *
 * <p><strong>One suite for two items because they are one situation.</strong> A priced service
 * request is committed unpaid and only the Cashfree webhook moves it on, so closing the modal
 * without paying left the row in a state with no exit: ops cannot see it, {@code PATCH /status} is
 * staff-only, and the one-open-unpaid cap then refused the customer's next attempt while pointing
 * at a request they could do nothing with (D152). The cap that did the refusing was itself
 * check-then-act, so it held against the double click it was written for and not against a loop
 * (D153). Fixing either alone leaves the customer stuck: a cap you cannot get out from under, or an
 * exit from a cap that does not hold.
 *
 * <p><strong>Why there are no threads here</strong> — the same reason {@code OpsQueueConcurrencyTest}
 * has none. A race reproduced with threads is a race reproduced <em>sometimes</em>, and a flaky test
 * guarding concurrency is worse than none. What the D153 fix adds is a uniqueness constraint, and a
 * constraint's whole point is that it does not depend on timing: a second row that would violate it
 * is refused whether it arrives a millisecond later or a day later. So the tests below insert the
 * second row directly, past the service's count, and assert the database's own answer.
 *
 * <p>The sweep is driven by calling {@code expireAbandonedCheckouts(cutoff)} with a fabricated
 * instant rather than by waiting on {@code AbandonedCheckoutSweep}'s schedule — the split between
 * the trigger and the work exists precisely so no test has to wait on a wall clock.
 */
@DisplayName("Slice 11 — the exit from an unpaid service request, and the cap's floor")
class ServiceRequestUnpaidExitTest extends ServiceFixtures {

    /**
     * Composed the same way the controller composes it, and deliberately not copied as a literal:
     * if the path moves, this fails to compile rather than silently testing a 404.
     */
    private static final String CANCEL = Routes.ServiceRequests.BY_ID + "/cancel";

    @Nested
    @DisplayName("the customer cancels their own abandoned checkout (D152)")
    class SelfCancel {

        /**
         * Self-cancel writes an audit row, and audit runs {@code REQUIRES_NEW} — so it commits even
         * though the test transaction rolls back (see {@code AbstractApiTest}). Clear it, or the row
         * outlives the suite.
         *
         * <p>Declared on this nested class rather than the outer one on purpose: {@code CapFloor}
         * deliberately provokes a constraint violation, which leaves the database transaction
         * aborted, and an inherited {@code @AfterEach} issuing SQL would then fail there instead of
         * where the assertion is.
         */
        @AfterEach
        void clearAudit() {
            jdbc.update("delete from audit_log where action = 'service-request.cancelled-unpaid'");
        }

        @Test
        @DisplayName("the requester may cancel an unpaid request, and the timeline says why")
        void requesterCancelsTheirOwn() throws Exception {
            User buyer = customer("9820000901");
            String id = raiseUnpaid(buyer, listing(buyer));

            cancel(buyer, id, 200);

            expectStatus(buyer, id, ServiceRequestStatuses.CANCELLED);
            // payment.abandoned, not payment.failed: no money was ever attempted, and support needs
            // to be able to tell "my card was declined" from "I closed the tab".
            mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.timeline[?(@.event=='payment.abandoned')]", hasSize(1)))
                    .andExpect(jsonPath("$.timeline[?(@.event=='payment.failed')]", hasSize(0)));
        }

        @Test
        @DisplayName("cancelling releases the desk — the whole point of D152")
        void cancellingReleasesTheCap() throws Exception {
            User buyer = customer("9820000902");
            Property p = listing(buyer);
            String first = raiseUnpaid(buyer, p);

            // Before: the cap refuses, because the abandoned request still holds the slot.
            create(buyer, p, 409);

            cancel(buyer, first, 200);

            // After: the desk is open again. Nothing was charged for either.
            create(buyer, p, 201);
        }

        @Test
        @DisplayName("a staff caller is refused — they already have PATCH /status")
        void staffCannotUseTheCustomersDoor() throws Exception {
            User buyer = customer("9820000903");
            User desk = staff("9820000904", Teams.LEGAL);
            String id = raiseUnpaid(buyer, listing(buyer));

            cancel(desk, id, 403);
            expectStatus(buyer, id, ServiceRequestStatuses.AWAITING_PAYMENT);
        }

        @Test
        @DisplayName("a stranger gets 404, never 403 — the same rule as every other read")
        void aStrangersRequestIsInvisible() throws Exception {
            User buyer = customer("9820000905");
            User other = customer("9820000906");
            String id = raiseUnpaid(buyer, listing(buyer));

            cancel(other, id, 404);
        }

        @Test
        @DisplayName("a paid request cannot be cancelled here — status is the never-paid proof")
        void aPaidRequestIsRefused() throws Exception {
            User buyer = customer("9820000907");
            String id = raiseUnpaid(buyer, listing(buyer));
            deliverSigned(paymentRef(id), true);
            expectStatus(buyer, id, ServiceRequestStatuses.NEW);

            cancel(buyer, id, 409);
            expectStatus(buyer, id, ServiceRequestStatuses.NEW);
        }

        @Test
        @DisplayName("cancelling twice is a 409, not a second cancellation")
        void cancellingTwiceIsRefused() throws Exception {
            User buyer = customer("9820000908");
            String id = raiseUnpaid(buyer, listing(buyer));

            cancel(buyer, id, 200);
            cancel(buyer, id, 409);
        }
    }

    @Nested
    @DisplayName("the sweep closes checkouts nobody came back to (D152)")
    class ExpirySweep {

        @Test
        @DisplayName("an unpaid request past the TTL is cancelled, and the desk reopens")
        void staleCheckoutsAreCancelled() throws Exception {
            User buyer = customer("9820000910");
            Property p = listing(buyer);
            String id = raiseUnpaid(buyer, p);

            assertThat(serviceRequests.expireAbandonedCheckouts(future())).isEqualTo(1);

            expectStatus(buyer, id, ServiceRequestStatuses.CANCELLED);
            // The point of the sweep: the customer who never came back is not locked out either.
            create(buyer, p, 201);
        }

        @Test
        @DisplayName("a checkout still inside its TTL is left alone")
        void freshCheckoutsSurvive() throws Exception {
            User buyer = customer("9820000911");
            String id = raiseUnpaid(buyer, listing(buyer));

            assertThat(serviceRequests.expireAbandonedCheckouts(past())).isZero();

            expectStatus(buyer, id, ServiceRequestStatuses.AWAITING_PAYMENT);
        }

        @Test
        @DisplayName("a paid request is never touched, however old it is")
        void paidRequestsAreUntouchable() throws Exception {
            User buyer = customer("9820000912");
            String id = raiseUnpaid(buyer, listing(buyer));
            deliverSigned(paymentRef(id), true);

            assertThat(serviceRequests.expireAbandonedCheckouts(future())).isZero();

            expectStatus(buyer, id, ServiceRequestStatuses.NEW);
        }

        @Test
        @DisplayName("a second pass over the same rows cancels nothing further")
        void theSweepIsIdempotent() throws Exception {
            User buyer = customer("9820000913");
            raiseUnpaid(buyer, listing(buyer));

            assertThat(serviceRequests.expireAbandonedCheckouts(future())).isEqualTo(1);
            assertThat(serviceRequests.expireAbandonedCheckouts(future())).isZero();
        }

        /** Every request in this suite is younger than this, so the whole set is "past its TTL". */
        private Instant future() {
            return Instant.now().plus(Duration.ofMinutes(5));
        }

        /** Older than anything this suite creates, so nothing is stale. */
        private Instant past() {
            return Instant.now().minus(Duration.ofHours(1));
        }
    }

    @Nested
    @DisplayName("the unpaid-order cap has a floor in the database (D153)")
    class CapFloor {

        /**
         * Bypasses {@code create} entirely — a raw INSERT is what a lost race amounts to: a second
         * row arriving after the count read zero. If the partial unique index were missing this
         * would succeed, which is exactly the unbounded-orders outcome D153 records.
         */
        @Test
        @DisplayName("a second open unpaid row for the same requester and desk is refused")
        void theDatabaseRefusesTheSecondRow() throws Exception {
            User buyer = customer("9820000920");
            raiseUnpaid(buyer, listing(buyer));

            // Nothing may follow: a constraint violation leaves the transaction rollback-only.
            assertThatThrownBy(() -> insertOpenUnpaid(buyer, "rent-agreement"))
                    .isInstanceOf(DataIntegrityViolationException.class);
        }

        @Test
        @DisplayName("the index is scoped to one requester and one desk, and nothing wider")
        void theIndexIsNarrow() throws Exception {
            User buyer = customer("9820000921");
            User other = customer("9820000922");
            raiseUnpaid(buyer, listing(buyer));

            // A different person's unpaid request on the same desk is not in conflict...
            insertOpenUnpaid(other, "rent-agreement");
            // ...nor is the same person's on a different desk.
            insertOpenUnpaid(buyer, "legal");

            assertThat(openUnpaidCount(buyer)).isEqualTo(2);
            assertThat(openUnpaidCount(other)).isEqualTo(1);
        }

        @Test
        @DisplayName("a settled request leaves the index, so the next one is free to open")
        void settledRowsLeaveTheIndex() throws Exception {
            User buyer = customer("9820000923");
            Property p = listing(buyer);
            String first = raiseUnpaid(buyer, p);
            deliverSigned(paymentRef(first), true);

            // Paid, so out of the predicate: a second unpaid row for the same desk is now legal at
            // the database as well as at the service. The cap is on outstanding orders, not volume.
            create(buyer, p, 201);
            insertOpenUnpaid(buyer, "legal");
        }

        /** The count-based fast path still answers first, with the same 409 the index would give. */
        @Test
        @DisplayName("the ordinary double click is still refused by the count, not by the index")
        void theFastPathStillAnswersFirst() throws Exception {
            User buyer = customer("9820000924");
            Property p = listing(buyer);
            raiseUnpaid(buyer, p);

            create(buyer, p, 409);
            // Still one row: the count refused before anything was inserted, so no constraint was
            // reached and the transaction is still usable.
            assertThat(openUnpaidCount(buyer)).isEqualTo(1);
        }

        private void insertOpenUnpaid(User requester, String type) {
            jdbc.update("insert into service_requests (requester_id, type, status) "
                    + "values (?, ?, 'awaiting-payment')", requester.getId(), type);
        }

        private int openUnpaidCount(User requester) {
            Integer count = jdbc.queryForObject(
                    "select count(*) from service_requests "
                            + "where status = 'awaiting-payment' and requester_id = ?",
                    Integer.class, requester.getId());
            return count == null ? 0 : count;
        }
    }

    @Nested
    @DisplayName("the cap's 409 describes something the customer can actually do (D152)")
    class CapMessage {

        @Test
        @DisplayName("it offers cancellation and expiry, not the two dead ends it used to")
        void theMessageNamesRealActions() throws Exception {
            User buyer = customer("9820000930");
            Property p = listing(buyer);
            raiseUnpaid(buyer, p);

            mvc.perform(post(Routes.ServiceRequests.BASE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(createBody(p)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", containsString("Cancel it")))
                    .andExpect(jsonPath("$.message", containsString("expired")))
                    // The old wording told them to do one of two things they could not do.
                    .andExpect(jsonPath("$.message",
                            not(containsString("Pay for it or cancel it"))));
        }
    }

    // ---------------------------------------------------------------- helpers

    private void cancel(User caller, String id, int expected) throws Exception {
        mvc.perform(post(CANCEL, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().is(expected));
    }

    /** Raise a rent agreement and assert only the status code — the body varies by outcome. */
    private void create(User caller, Property property, int expected) throws Exception {
        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(property)))
                .andExpect(status().is(expected));
    }

    private static String createBody(Property property) {
        return "{\"type\":\"rent-agreement\",\"propertyId\":\"" + property.getId() + "\"}";
    }
}
