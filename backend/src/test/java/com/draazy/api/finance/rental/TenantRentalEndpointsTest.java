package com.draazy.api.finance.rental;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.time.LocalDate;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

// Contract and behaviour proof for `/me/rentals` — the tenant's own record of the home they already rent, which is what
// Isolation.
@DisplayName("Self-declared rentals — the tenant's own record, scoped to nobody else")
class TenantRentalEndpointsTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @Autowired TenantRentalRepository rentals;

    private User tenant(String mobile) {

        User u = new User(mobile, "buyer");
        u.setName("Rental Tenant " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    // A bare `LocalDate.now()` reads the JVM's zone, a day behind IST after 18:30 on a UTC host, so the test reads
    // the service's clock.
    private static LocalDate today() {
        return LocalDate.now(PlatformTime.IST);
    }

    private static String createBody(String address, long rent, LocalDate start) {
        return """
                {"address":"%s","monthlyRent":%d,
                 "deposit":100000,"leaseStart":"%s"}
                """.formatted(address, rent, start);
    }

    @Test
    @DisplayName("records a rental, lists it back, and derives months due inclusive of the first month")
    void derivesMonthsDue() throws Exception {
        User me = tenant("9811000102");
        LocalDate start = today().minusMonths(6).withDayOfMonth(1);

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 7, Baner", 20000L, start)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.address").value("Flat 7, Baner"))
                .andExpect(jsonPath("$.monthlyRent").value(20000))
                .andExpect(jsonPath("$.status").value("active"))
                .andExpect(jsonPath("$.monthsPaid").value(7))
                .andExpect(jsonPath("$.totalPaid").value(140000));

        mvc.perform(get("/me/rentals").header(HttpHeaders.AUTHORIZATION, bearer(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
        // Deliberately not asserting the row is still `active` afterwards. AbstractApiTest is @Transactional, so
        // every request here joins the test's transaction.
    }

    // A lease entirely in the future accrues nothing rather than a negative count — the create
    // request deliberately allows it, because signing next month's lease is a real fact.
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

    // Soft, not hard. A tenant who deletes the wrong lease has otherwise lost a year of their own
    // record, and the row is still the evidence behind an HRA figure they may already have filed.
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

                .andExpect(jsonPath("$.monthsPaid").value(6))
                .andExpect(jsonPath("$.totalPaid").value(90000));
    }

    // ---- isolation ----
    static Stream<Arguments> patchesThatAreRefused() {
        LocalDate start = LocalDate.now(PlatformTime.IST).minusMonths(2);
        return Stream.of(
                // A null leaseEnd means "still running" to the derivation, so ending without one would
                // leave the lease accruing an instalment a month for ever.
                Arguments.of("ending a lease without a leaseEnd", "{\"status\":\"ended\"}"),
                Arguments.of("a leaseEnd before the leaseStart, an integrity violation if it got through",
                        "{\"leaseEnd\":\"%s\"}".formatted(start.minusDays(1))),
                Arguments.of("an unknown status", "{\"status\":\"vacated\"}"));
    }

    @ParameterizedTest(name = "{0} is a 400")
    @MethodSource("patchesThatAreRefused")
    void aRefusedPatchIsABadRequest(String description, String body) throws Exception {
        User me = tenant("9811000113");
        String id = idOf(create(me, "Flat 5, Viman Nagar", 19000L, today().minusMonths(2)));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a mistyped lease year is a 422 naming the field, not a 409 about a conflict")
    void impossibleLeaseStartIsRejectedBeforeTheDatabase() throws Exception {
        User me = tenant("9811000114");

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 8, Pashan", 21000L, LocalDate.of(1899, 5, 1))))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 8, Pashan", 21000L, today().plusYears(5))))
                .andExpect(status().isUnprocessableEntity());
    }

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

    @Test
    @DisplayName("PATCH leaves absent fields alone, and a stale client's landlordName is ignored")
    void patchIsPartial() throws Exception {
        User me = tenant("9811000105");
        String id = idOf(create(me, "Flat 11, Aundh", 18000L));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"monthlyRent\":21000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.monthlyRent").value(21000))
                .andExpect(jsonPath("$.address").value("Flat 11, Aundh"));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"landlordName\":\"Mr Deshpande\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.landlordName").doesNotExist());
    }

    @Test
    @DisplayName("a non-positive rent is rejected")
    void nonPositiveRentIsRejected() throws Exception {
        User me = tenant("9811000108");

        mvc.perform(post("/me/rentals")
                        .header(HttpHeaders.AUTHORIZATION, bearer(me))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("Flat 1, Nowhere", 0L, today())))
                .andExpect(status().isUnprocessableEntity());
    }

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

    @Test
    @DisplayName("a stranger cannot see or touch somebody else's rental")
    void aStrangerCannotSeeOrTouchSomebodyElsesRental() throws Exception {
        User me = tenant("9811000110");
        User stranger = tenant("9811000111");
        String id = idOf(create(me, "Flat 14, Koregaon Park", 45000L));

        mvc.perform(get("/me/rentals").header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));

        mvc.perform(patch("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"monthlyRent\":1}"))
                .andExpect(status().isNotFound());

        mvc.perform(delete("/me/rentals/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

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
