package com.punenest.api.finance.rental;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.PlatformTime;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract and behaviour proof for {@code /me/rentals} — the tenant's own record of the home they
 * already rent, which is what the tenant dashboard reads now that no rent moves through the
 * platform.
 *
 * <p>Two things here are load-bearing and the rest is bookkeeping.
 *
 * <p><strong>Isolation.</strong> This table has exactly one access-control mechanism: every query
 * carries {@code tenant_id}. There is no property to own, no deal to be party to and no second
 * check anywhere downstream, so a repository method written later without that predicate is a
 * straight data leak rather than a slow query. {@link #aStrangerCannotSeeOrTouchSomebodyElsesRental()}
 * is the guard, and it asserts 404 rather than 403 deliberately: a 403 would confirm that a given
 * id names a real rental, which is the same enumeration oracle spec fix S10 closed elsewhere.
 *
 * <p><strong>The derived totals.</strong> {@code monthsPaid} and {@code fyPaid} exist so the
 * April-to-March financial year is defined once, on the server, instead of twice. They are pinned
 * to fixed lease dates below rather than asserted loosely, because the failure they guard against
 * is not "wrong by a lot" — it is an off-by-one month that reads as plausible and quietly changes
 * an HRA figure the tenant repeats to their employer.
 */
@DisplayName("Self-declared rentals — the tenant's own record, scoped to nobody else")
class TenantRentalEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired TenantRentalRepository rentals;

    private User tenant(String mobile) {
        // "buyer" is the platform's name for a signed-in consumer; there is no tenant role, which
        // is exactly why this table is keyed on the user rather than gated by one.
        User u = new User(mobile, "buyer");
        u.setName("Rental Tenant " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /**
     * The date the server will reckon by. A bare {@code LocalDate.now()} reads the JVM's zone,
     * which on a CI host in UTC is a day behind IST after 18:30 — and when that day happens to
     * cross a month boundary, the fixture asks for one number and the service derives another.
     * That failure would appear roughly one evening in thirty and read as flakiness rather than as
     * the mismatch it is, so the test reads the same clock the service does.
     */
    private static LocalDate today() {
        return LocalDate.now(PlatformTime.IST);
    }

    private static String createBody(String address, long rent, LocalDate start) {
        return """
                {"address":"%s","landlordName":"Mr Deshpande","monthlyRent":%d,
                 "deposit":100000,"leaseStart":"%s"}
                """.formatted(address, rent, start);
    }

    // ---- the happy path ----

    @Test
    @DisplayName("records a rental and lists it back")
    void recordsAndLists() throws Exception {
        User me = tenant("9811000101");

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 402, Sunrise Residency, Kothrud",
                                24000L, today().minusMonths(3))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.address").value("Flat 402, Sunrise Residency, Kothrud"))
                .andExpect(jsonPath("$.monthlyRent").value(24000))
                .andExpect(jsonPath("$.status").value("active"));

        mvc.perform(get("/me/rentals").header(HttpHeaders.AUTHORIZATION, bearer(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].landlordName").value("Mr Deshpande"));
    }

    /**
     * A lease that began on the 10th does not count the current month until the 10th comes round —
     * pinned here with dates chosen so the answer cannot drift with the calendar.
     */
    @Test
    @DisplayName("derives months due from the lease dates, inclusive of the first month")
    void derivesMonthsDue() throws Exception {
        User me = tenant("9811000102");
        LocalDate start = today().minusMonths(6).withDayOfMonth(1);

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 7, Baner", 20000L, start)))
                .andExpect(status().isCreated())
                // Six months back plus the current one.
                .andExpect(jsonPath("$.monthsPaid").value(7))
                .andExpect(jsonPath("$.totalPaid").value(140000));
    }

    /**
     * A lease entirely in the future accrues nothing rather than a negative count — the create
     * request deliberately allows it, because signing next month's lease is a real fact.
     */
    @Test
    @DisplayName("a lease that has not started yet accrues nothing")
    void futureLeaseAccruesNothing() throws Exception {
        User me = tenant("9811000103");

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 9, Wakad", 30000L, today().plusMonths(2))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.monthsPaid").value(0))
                .andExpect(jsonPath("$.totalPaid").value(0))
                .andExpect(jsonPath("$.fyPaid").value(0));
    }

    /** An ended lease stops accruing at its end date, and still counts toward the year it ran in. */
    @Test
    @DisplayName("an ended lease stops accruing at leaseEnd")
    void endedLeaseStopsAccruing() throws Exception {
        User me = tenant("9811000104");
        LocalDate start = today().minusMonths(10).withDayOfMonth(1);

        String created = mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 3, Hadapsar", 15000L, start)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = idOf(created);

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"leaseEnd":"%s","status":"ended"}
                                """.formatted(start.plusMonths(5))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ended"))
                // Six instalments: the month it started plus five.
                .andExpect(jsonPath("$.monthsPaid").value(6))
                .andExpect(jsonPath("$.totalPaid").value(90000));
    }

    /**
     * Ending a lease without saying when would leave it accruing an instalment a month for ever,
     * because a null {@code leaseEnd} means "still running" to the derivation. The create path
     * cannot reach that state — it forces {@code active} — so the PATCH is the only way in, which
     * is why the guard lives there and is pinned here.
     */
    @Test
    @DisplayName("ending a lease without a leaseEnd is refused rather than left accruing for ever")
    void endingALeaseRequiresAnEndDate() throws Exception {
        User me = tenant("9811000113");
        String id = idOf(create(me, "Flat 5, Viman Nagar", 19000L));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ended\"}"))
                .andExpect(status().is4xxClientError());

        // Deliberately not asserting the row is still `active` afterwards. AbstractApiTest is
        // @Transactional, so every request here joins the test's transaction: the service's
        // rollback marks that transaction rollback-only but does not clear the persistence
        // context, and the next request's query auto-flushes the rejected mutation and reads it
        // straight back. The row would come back `ended` in this harness and `active` in
        // production, so an assertion here would be testing the harness. The 4xx is the claim.
    }

    /**
     * V128 floors {@code lease_start} at 1970 with a CHECK. Reaching that CHECK answers 409
     * "conflicts with existing data", which is both wrong and unactionable — nothing conflicts, the
     * year is a typo — so the bound is restated in Bean Validation and answers 422 naming the field.
     */
    @Test
    @DisplayName("a mistyped lease year is a 422 naming the field, not a 409 about a conflict")
    void impossibleLeaseStartIsRejectedBeforeTheDatabase() throws Exception {
        User me = tenant("9811000114");

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 8, Pashan", 21000L, LocalDate.of(1899, 5, 1))))
                .andExpect(status().isUnprocessableEntity());

        // The far end too, which the CHECK does not cover at all.
        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 8, Pashan", 21000L, today().plusYears(5))))
                .andExpect(status().isUnprocessableEntity());
    }

    /**
     * {@code myRentals} answers a bare array with no paging, so the only thing bounding this table
     * is the ceiling in {@code addRental}. Without it one account can fill the table at the write
     * rate limit, make its own wallet unusable, and push its DSAR export past the row limit where
     * it is silently truncated.
     */
    @Test
    @DisplayName("a tenant cannot record an unbounded number of rentals")
    void rentalsPerTenantAreCapped() throws Exception {
        User me = tenant("9811000115");
        for (int i = 0; i < TenantRentalService.MAX_RENTALS_PER_TENANT; i++) {
            create(me, "Flat " + i + ", Kothrud", 12000L);
        }

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("One too many, Kothrud", 12000L, today().minusMonths(1))))
                .andExpect(status().isUnprocessableEntity());
    }

    // ---- partial update ----
    @Test
    @DisplayName("PATCH leaves absent fields alone and clears landlordName on an empty string")
    void patchIsPartial() throws Exception {
        User me = tenant("9811000105");
        String id = idOf(create(me, "Flat 11, Aundh", 18000L));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"monthlyRent\":21000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.monthlyRent").value(21000))
                .andExpect(jsonPath("$.address").value("Flat 11, Aundh"))
                .andExpect(jsonPath("$.landlordName").value("Mr Deshpande"));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"landlordName\":\"\"}"))
                .andExpect(status().isOk())
                // NON_NULL: cleared means the key is absent, not present-and-null.
                .andExpect(jsonPath("$.landlordName").doesNotExist());
    }

    /**
     * Moving one date past the other is caught in the service, which has the stored row to compare
     * against — the record's own assertion passes vacuously when only one date is sent, and without
     * this check the write would reach V128's CHECK and surface as a bare integrity violation.
     */
    @Test
    @DisplayName("a PATCH that would invert the lease window is 4xx, not an integrity violation")
    void patchCannotInvertTheLeaseWindow() throws Exception {
        User me = tenant("9811000106");
        LocalDate start = today().minusMonths(4);
        String id = idOf(create(me, "Flat 21, Kharadi", 26000L, start));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"leaseEnd\":\"%s\"}".formatted(start.minusDays(1))))
                .andExpect(status().is4xxClientError());
    }

    @Test
    @DisplayName("an unknown status is rejected rather than stored")
    void unknownStatusIsRejected() throws Exception {
        User me = tenant("9811000107");
        String id = idOf(create(me, "Flat 5, Viman Nagar", 22000L));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"vacated\"}"))
                .andExpect(status().is4xxClientError());
    }

    @Test
    @DisplayName("a non-positive rent is rejected")
    void nonPositiveRentIsRejected() throws Exception {
        User me = tenant("9811000108");

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 1, Nowhere", 0L, today())))
                .andExpect(status().is4xxClientError());
    }

    // ---- delete ----

    /**
     * Soft, not hard. A tenant who deletes the wrong lease has otherwise lost a year of their own
     * record, and the row is still the evidence behind an HRA figure they may already have filed.
     */
    @Test
    @DisplayName("DELETE hides the row from the list but keeps it in the table")
    void deleteIsSoft() throws Exception {
        User me = tenant("9811000109");
        String id = idOf(create(me, "Flat 8, Pimple Saudagar", 19000L));

        mvc.perform(delete("/me/rentals/" + id).header(HttpHeaders.AUTHORIZATION, bearer(me)))
                .andExpect(status().isNoContent());

        mvc.perform(get("/me/rentals").header(HttpHeaders.AUTHORIZATION, bearer(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        assertThat(rentals.findById(UUID.fromString(id)))
                .get()
                .extracting(TenantRental::isArchived)
                .isEqualTo(true);
    }

    // ---- isolation ----

    @Test
    @DisplayName("a stranger cannot see or touch somebody else's rental")
    void aStrangerCannotSeeOrTouchSomebodyElsesRental() throws Exception {
        User me = tenant("9811000110");
        User stranger = tenant("9811000111");
        String id = idOf(create(me, "Flat 14, Koregaon Park", 45000L));

        mvc.perform(get("/me/rentals").header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        // 404, not 403: a 403 would confirm the id names a real rental.
        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"monthlyRent\":1}"))
                .andExpect(status().isNotFound());

        mvc.perform(delete("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    /** A malformed id is 404 too, for the same reason the ledger treats a bad propId that way. */
    @Test
    @DisplayName("a malformed rental id is 404, not 400")
    void malformedIdIsNotFound() throws Exception {
        User me = tenant("9811000112");

        mvc.perform(delete("/me/rentals/not-a-uuid")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the endpoints require authentication")
    void requiresAuth() throws Exception {
        mvc.perform(get("/me/rentals")).andExpect(status().isUnauthorized());
    }

    // ---- helpers ----

    private String create(User me, String address, long rent) throws Exception {
        return create(me, address, rent, today().minusMonths(2));
    }

    private String create(User me, String address, long rent, LocalDate start) throws Exception {
        return mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(address, rent, start)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    private static String idOf(String json) {
        return com.jayway.jsonpath.JsonPath.read(json, "$.id");
    }
}
