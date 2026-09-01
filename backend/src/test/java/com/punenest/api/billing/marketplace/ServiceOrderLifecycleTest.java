package com.punenest.api.billing.marketplace;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import java.util.List;
import java.util.Set;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The service-order lifecycle (D58) — the endpoints that did not exist, and the refusals that are
 * the whole point of having them.
 *
 * <p><strong>Most of this file is negative.</strong> A state machine with only a happy-path test is
 * a suggestion: the code that matters is the code that says no, and every one of these refusals was
 * previously "whoever writes the UPDATE will know". So the sweep below walks every {@code (from,
 * to)} pair the machine does not allow and insists on a 409 for each one, rather than sampling two
 * and trusting the map.
 *
 * <p>The four properties being defended:
 *
 * <ol>
 *   <li><strong>An illegal move is refused, never silently ignored.</strong> 409, with the current
 *       state named, from both the ops door and the customer's.</li>
 *   <li><strong>{@code amount} belongs to the quote.</strong> Required when quoting, refused with
 *       every other status, and — because the machine has no edge back to {@code quoted} — not
 *       reachable at all once the customer has accepted.</li>
 *   <li><strong>The desk that prices a job cannot accept its own price.</strong> {@code scheduled}
 *       is not ops-settable, and staff are turned away from the customer's accept door.</li>
 *   <li><strong>A stranger's order is invisible.</strong> 404 rather than 403, so the customer
 *       endpoints cannot be used to discover which order ids exist.</li>
 * </ol>
 */
class ServiceOrderLifecycleTest extends AbstractApiTest {

    /** Packers &amp; Movers, seeded by {@code R__DML_seed_reference_data.sql}. */
    private static final String OFFERING = "b3000000-0000-4000-8000-000000000001";

    /** Whole rupees, as {@code service_orders.amount} stores them. */
    private static final long QUOTE = 18_500L;

    /** Everything {@code PATCH /service-orders/{id}/status} accepts. */
    private static final List<String> OPS_SETTABLE = List.of(
            ServiceOrderStatuses.QUOTED,
            ServiceOrderStatuses.IN_PROGRESS,
            ServiceOrderStatuses.COMPLETED,
            ServiceOrderStatuses.CANCELLED);

    /** Every state an order can be parked in, for the illegal-move sweep. */
    private static final List<String> EVERY_STATE = List.of(
            ServiceOrderStatuses.PLACED,
            ServiceOrderStatuses.QUOTED,
            ServiceOrderStatuses.SCHEDULED,
            ServiceOrderStatuses.IN_PROGRESS,
            ServiceOrderStatuses.COMPLETED,
            ServiceOrderStatuses.CANCELLED);

    @Autowired UserRepository users;
    @Autowired ServiceOrderRepository orders;

    /** Audit writes are {@code REQUIRES_NEW}, so they survive the rollback and must be swept. */
    @AfterEach
    void clearAudit() {
        jdbc.update("delete from audit_log where entity = 'service_order'");
    }

    // ---- fixtures ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Order User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String placeOrder(User customer) throws Exception {
        String body = mvc.perform(post(Routes.ServiceCatalog.ORDERS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(customer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offeringId\":\"" + OFFERING + "\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value(ServiceOrderStatuses.PLACED))
                .andExpect(jsonPath("$.amount").value(Matchers.nullValue()))
                .andReturn().getResponse().getContentAsString();
        int i = body.indexOf("\"id\":\"") + 6;
        return body.substring(i, body.indexOf('"', i));
    }

    private ResultActions ops(User staff, String orderId, String status, Long amount)
            throws Exception {
        String body = amount == null
                ? "{\"status\":\"" + status + "\"}"
                : "{\"status\":\"" + status + "\",\"amount\":" + amount + "}";
        return mvc.perform(patch(Routes.ServiceCatalog.ORDER_STATUS, orderId)
                .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions accept(User caller, String orderId) throws Exception {
        return mvc.perform(post(Routes.ServiceCatalog.ORDER_ACCEPT, orderId)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller)));
    }

    private ResultActions cancel(User caller, String orderId) throws Exception {
        return mvc.perform(post(Routes.ServiceCatalog.ORDER_CANCEL, orderId)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller)));
    }

    /** An order parked in {@code state}, reached only through the endpoints under test. */
    private String orderAt(User customer, User staff, String state) throws Exception {
        String id = placeOrder(customer);
        if (ServiceOrderStatuses.PLACED.equals(state)) {
            return id;
        }
        if (ServiceOrderStatuses.CANCELLED.equals(state)) {
            cancel(customer, id).andExpect(status().isOk());
            return id;
        }
        ops(staff, id, ServiceOrderStatuses.QUOTED, QUOTE).andExpect(status().isOk());
        if (ServiceOrderStatuses.QUOTED.equals(state)) {
            return id;
        }
        accept(customer, id).andExpect(status().isOk());
        if (ServiceOrderStatuses.SCHEDULED.equals(state)) {
            return id;
        }
        ops(staff, id, ServiceOrderStatuses.IN_PROGRESS, null).andExpect(status().isOk());
        if (ServiceOrderStatuses.IN_PROGRESS.equals(state)) {
            return id;
        }
        ops(staff, id, ServiceOrderStatuses.COMPLETED, null).andExpect(status().isOk());
        return id;
    }

    // ---- 1: the happy path, end to end ----

    @Test
    void anOrderWalksPlacedQuotedScheduledInProgressCompleted() throws Exception {
        User customer = user("9866600001", Roles.Wire.BUYER);
        User staff = user("9866600002", Roles.Wire.STAFF);
        String id = placeOrder(customer);

        ops(staff, id, ServiceOrderStatuses.QUOTED, QUOTE)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ServiceOrderStatuses.QUOTED))
                .andExpect(jsonPath("$.amount").value((int) QUOTE));

        accept(customer, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ServiceOrderStatuses.SCHEDULED))
                .andExpect(jsonPath("$.amount").value((int) QUOTE));

        ops(staff, id, ServiceOrderStatuses.IN_PROGRESS, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ServiceOrderStatuses.IN_PROGRESS));

        ops(staff, id, ServiceOrderStatuses.COMPLETED, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ServiceOrderStatuses.COMPLETED))
                .andExpect(jsonPath("$.amount").value((int) QUOTE));
    }

    @Test
    void aPlacedOrderCanBeCancelledOutrightByOps() throws Exception {
        User customer = user("9866600003", Roles.Wire.BUYER);
        User staff = user("9866600004", Roles.Wire.STAFF);
        String id = placeOrder(customer);

        ops(staff, id, ServiceOrderStatuses.CANCELLED, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(ServiceOrderStatuses.CANCELLED));
    }

    // ---- 2: every illegal move is a 409 ----

    /**
     * The sweep. For each of the six states, every ops-settable target the machine does not allow
     * from there must answer 409 — not 200, and not a quiet no-op that leaves the caller believing
     * the order moved.
     */
    @Test
    void everyIllegalOpsTransitionIsRefusedWith409() throws Exception {
        User customer = user("9866600005", Roles.Wire.BUYER);
        User staff = user("9866600006", Roles.Wire.STAFF);

        for (String from : EVERY_STATE) {
            for (String to : OPS_SETTABLE) {
                if (ServiceOrderStatuses.canTransition(from, to)) {
                    continue;
                }
                String id = orderAt(customer, staff, from);
                Long amount = ServiceOrderStatuses.QUOTED.equals(to) ? QUOTE : null;
                ops(staff, id, to, amount)
                        .andExpect(status().isConflict())
                        .andExpect(jsonPath("$.error").value("conflict"));
                assertThat(orders.findById(java.util.UUID.fromString(id)).orElseThrow().getStatus())
                        .as("%s -> %s was refused, so the row must not have moved", from, to)
                        .isEqualTo(from);
            }
        }
    }

    /** Acceptance is legal from {@code quoted} and from nowhere else. */
    @Test
    void acceptIsRefusedFromEveryStateButQuoted() throws Exception {
        User customer = user("9866600007", Roles.Wire.BUYER);
        User staff = user("9866600008", Roles.Wire.STAFF);

        for (String from : EVERY_STATE) {
            if (ServiceOrderStatuses.QUOTED.equals(from)) {
                continue;
            }
            String id = orderAt(customer, staff, from);
            accept(customer, id).andExpect(status().isConflict());
        }
    }

    /** Cancellation is legal before work starts and impossible after. */
    @Test
    void cancelIsRefusedOnceWorkHasStarted() throws Exception {
        User customer = user("9866600009", Roles.Wire.BUYER);
        User staff = user("9866600010", Roles.Wire.STAFF);

        Set<String> closedToCancel = Set.of(ServiceOrderStatuses.IN_PROGRESS,
                ServiceOrderStatuses.COMPLETED, ServiceOrderStatuses.CANCELLED);
        for (String from : EVERY_STATE) {
            String id = orderAt(customer, staff, from);
            if (closedToCancel.contains(from)) {
                cancel(customer, id).andExpect(status().isConflict());
            } else {
                cancel(customer, id)
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.status").value(ServiceOrderStatuses.CANCELLED));
            }
        }
    }

    @Test
    void anUnknownStatusIsRejectedBeforeAnythingElse() throws Exception {
        User customer = user("9866600011", Roles.Wire.BUYER);
        User staff = user("9866600012", Roles.Wire.STAFF);
        String id = placeOrder(customer);

        ops(staff, id, "refunded", null).andExpect(status().isBadRequest());
    }

    // ---- 3: amount belongs to the quote ----

    @Test
    void quotingWithoutAPriceIs422() throws Exception {
        User customer = user("9866600013", Roles.Wire.BUYER);
        User staff = user("9866600014", Roles.Wire.STAFF);
        String id = placeOrder(customer);

        ops(staff, id, ServiceOrderStatuses.QUOTED, null).andExpect(status().isUnprocessableEntity());
        ops(staff, id, ServiceOrderStatuses.QUOTED, 0L).andExpect(status().isUnprocessableEntity());
        ops(staff, id, ServiceOrderStatuses.QUOTED, -1L).andExpect(status().isUnprocessableEntity());
    }

    /**
     * The rule that makes this a quote rather than a price field: {@code amount} is refused on every
     * status but {@code quoted}, loudly, because dropping it silently would let a desk believe it
     * had repriced a job.
     */
    @Test
    void amountIsRefusedOnEveryStatusButTheQuote() throws Exception {
        User customer = user("9866600015", Roles.Wire.BUYER);
        User staff = user("9866600016", Roles.Wire.STAFF);

        String scheduled = orderAt(customer, staff, ServiceOrderStatuses.SCHEDULED);
        ops(staff, scheduled, ServiceOrderStatuses.IN_PROGRESS, 99_000L)
                .andExpect(status().isUnprocessableEntity());

        String working = orderAt(customer, staff, ServiceOrderStatuses.IN_PROGRESS);
        ops(staff, working, ServiceOrderStatuses.COMPLETED, 99_000L)
                .andExpect(status().isUnprocessableEntity());

        String placed = placeOrder(customer);
        ops(staff, placed, ServiceOrderStatuses.CANCELLED, 99_000L)
                .andExpect(status().isUnprocessableEntity());
    }

    /**
     * An accepted order cannot be repriced. There is no edge back to {@code quoted}, so the attempt
     * is a 409 and the agreed number is still the agreed number.
     */
    @Test
    void aQuoteCannotMoveAfterTheCustomerAcceptsIt() throws Exception {
        User customer = user("9866600017", Roles.Wire.BUYER);
        User staff = user("9866600018", Roles.Wire.STAFF);
        String id = orderAt(customer, staff, ServiceOrderStatuses.SCHEDULED);

        ops(staff, id, ServiceOrderStatuses.QUOTED, 99_000L).andExpect(status().isConflict());

        assertThat(orders.findById(java.util.UUID.fromString(id)).orElseThrow().getAmount())
                .isEqualTo(QUOTE);
    }

    // ---- 4: the guards ----

    /**
     * {@code scheduled} means the customer said yes. Ops asking for it is a 400 rather than a 409:
     * the status is real and the transition would be legal, so the refusal is about who is asking.
     */
    @Test
    void opsCannotAcceptItsOwnQuoteThroughTheStatusEndpoint() throws Exception {
        User customer = user("9866600019", Roles.Wire.BUYER);
        User staff = user("9866600020", Roles.Wire.STAFF);
        String id = orderAt(customer, staff, ServiceOrderStatuses.QUOTED);

        ops(staff, id, ServiceOrderStatuses.SCHEDULED, null).andExpect(status().isBadRequest());
        ops(staff, id, ServiceOrderStatuses.PLACED, null).andExpect(status().isBadRequest());
    }

    /** ...and cannot reach it through the customer's door either, even on its own order. */
    @Test
    void staffAreRefusedOnTheCustomerDoors() throws Exception {
        User staff = user("9866600021", Roles.Wire.STAFF);
        User admin = user("9866600022", Roles.Wire.ADMIN);
        User otherStaff = user("9866600023", Roles.Wire.STAFF);

        String staffOwnOrder = placeOrder(staff);
        ops(otherStaff, staffOwnOrder, ServiceOrderStatuses.QUOTED, QUOTE)
                .andExpect(status().isOk());

        accept(staff, staffOwnOrder).andExpect(status().isForbidden());
        cancel(staff, staffOwnOrder).andExpect(status().isForbidden());

        String adminOrder = placeOrder(admin);
        accept(admin, adminOrder).andExpect(status().isForbidden());
        cancel(admin, adminOrder).andExpect(status().isForbidden());
    }

    @Test
    void aCustomerCannotDriveTheOpsEndpoint() throws Exception {
        User customer = user("9866600024", Roles.Wire.BUYER);
        User owner = user("9866600025", Roles.Wire.OWNER);
        String id = placeOrder(customer);

        ops(customer, id, ServiceOrderStatuses.QUOTED, QUOTE).andExpect(status().isForbidden());
        ops(owner, id, ServiceOrderStatuses.QUOTED, QUOTE).andExpect(status().isForbidden());
    }

    /** Somebody else's order is invisible, never forbidden — a 403 would confirm the id exists. */
    @Test
    void aStrangersOrderIs404OnBothCustomerDoors() throws Exception {
        User customer = user("9866600026", Roles.Wire.BUYER);
        User stranger = user("9866600027", Roles.Wire.BUYER);
        User staff = user("9866600028", Roles.Wire.STAFF);
        String id = orderAt(customer, staff, ServiceOrderStatuses.QUOTED);

        accept(stranger, id).andExpect(status().isNotFound());
        cancel(stranger, id).andExpect(status().isNotFound());

        assertThat(orders.findById(java.util.UUID.fromString(id)).orElseThrow().getStatus())
                .isEqualTo(ServiceOrderStatuses.QUOTED);
    }

    @Test
    void anUnknownOrderIs404OnTheOpsEndpoint() throws Exception {
        User staff = user("9866600029", Roles.Wire.STAFF);

        ops(staff, "d0000000-0000-4000-8000-00000000dead", ServiceOrderStatuses.QUOTED, QUOTE)
                .andExpect(status().isNotFound());
        ops(staff, "not-a-uuid", ServiceOrderStatuses.QUOTED, QUOTE)
                .andExpect(status().isNotFound());
    }
}
