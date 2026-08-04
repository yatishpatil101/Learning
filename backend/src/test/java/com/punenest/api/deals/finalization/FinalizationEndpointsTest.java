package com.punenest.api.deals.finalization;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.deals.deal.DealStatuses;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * Contract + behaviour proof for the finalization sub-slice (A3), driven through the real filter
 * chain against the live Flyway'd Postgres under {@code ddl-auto=validate}.
 *
 * <p>Covers every test in the Â§11 bar: request with registered counterparty, unregistered mobile,
 * body propertyId mismatch, auto-decline atomicity, initiator self-accept, stranger scoping,
 * soft cancel, /me/finalization-requests scoping, mobile masking, duplicate prevention, illegal
 * transition, money round-trip, and route-constant agreement.
 */
class FinalizationEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired FinalizationRequestRepository finalizationRepo;
    @Autowired JdbcTemplate jdbc;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    // ---- helpers ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Test " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private String requestFinalization(User initiator, Property p, User counterparty,
                                        long price) throws Exception {
        String body = "{\"counterpartyMobile\":\"" + counterparty.getMobile()
                + "\",\"agreedPrice\":" + price + "}";
        MvcResult result = mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(initiator))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn();
        return extractId(result);
    }

    private String extractId(MvcResult result) throws Exception {
        String json = result.getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    // ---- Â§11 test 1: request with a registered counterparty â†’ 200, row stored pending ----

    @Test
    void requestFinalization_registeredCounterparty_returns200Pending() throws Exception {
        User owner = user("9830100001", "owner");
        User buyer = user("9830100002", "buyer");
        Property p = listing(owner, "Finalization test");

        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + owner.getMobile()
                                + "\",\"agreedPrice\":5000000}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$.agreedPrice").value(5000000))
                .andExpect(jsonPath("$.status").value(FinalizationStatuses.PENDING))
                .andExpect(jsonPath("$.initiator.id").value(buyer.getId().toString()))
                .andExpect(jsonPath("$.counterparty.id").value(owner.getId().toString()));
    }

    // ---- Â§11 test 2: unregistered mobile â†’ 422 ----

    @Test
    void requestFinalization_unregisteredMobile_returns400() throws Exception {
        User owner = user("9830100003", "owner");
        User buyer = user("9830100004", "buyer");
        Property p = listing(owner, "Unregistered test");

        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"9999999999\",\"agreedPrice\":5000000}"))
                .andExpect(status().isBadRequest())
                // Deliberately NOT "does not belong to a registered user". That phrasing turned
                // the endpoint into an account-enumeration oracle: a caller could probe any mobile
                // and learn from the wording whether it had an account. The message now describes
                // only what the caller got wrong about *this listing*.
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("listing owner")));
    }

    // ---- Â§11 test 3: body propertyId mismatching path â†’ 400 (S4) ----

    @Test
    void requestFinalization_bodyPropertyIdMismatch_returns400() throws Exception {
        User owner = user("9830100005", "owner");
        User buyer = user("9830100006", "buyer");
        Property p = listing(owner, "Mismatch test");

        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + UUID.randomUUID()
                                + "\",\"counterpartyMobile\":\"" + owner.getMobile()
                                + "\",\"agreedPrice\":5000000}"))
                .andExpect(status().isBadRequest());
    }

    // ---- Â§11 test 4: auto-decline â€” three requests, accept one â†’ siblings declined, deal closed ----

    @Test
    void acceptFinalization_autoDeclinesSiblingsAndClosesDeal() throws Exception {
        User owner = user("9830100007", "owner");
        User buyer1 = user("9830100008", "buyer");
        User buyer2 = user("9830100009", "buyer");
        User buyer3 = user("9830100010", "buyer");
        Property p = listing(owner, "Auto-decline test");

        String reqId1 = requestFinalization(buyer1, p, owner, 5000000L);
        String reqId2 = requestFinalization(buyer2, p, owner, 5500000L);
        String reqId3 = requestFinalization(buyer3, p, owner, 6000000L);

        // Owner accepts request 2.
        mvc.perform(post("/finalization/requests/" + reqId2 + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());

        // Assert: req2 accepted, req1 and req3 declined.
        assertThat(finalizationRepo.findById(UUID.fromString(reqId2)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.ACCEPTED);
        assertThat(finalizationRepo.findById(UUID.fromString(reqId1)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.DECLINED);
        assertThat(finalizationRepo.findById(UUID.fromString(reqId3)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.DECLINED);

        // Assert: deal is closed.
        String dealStatus = jdbc.queryForObject(
                "SELECT status FROM deals WHERE property_id = ?",
                String.class, p.getId());
        assertThat(dealStatus).isEqualTo(DealStatuses.CLOSED);
    }

    // ---- Â§11 test 5: atomicity â€” force deal close failure â†’ nothing committed ----

    @Test
    void acceptFinalization_dealAlreadyClosed_rollsBackEverything() throws Exception {
        User owner = user("9830100011", "owner");
        User buyer1 = user("9830100012", "buyer");
        User buyer2 = user("9830100013", "buyer");
        Property p = listing(owner, "Atomicity test");

        String reqId1 = requestFinalization(buyer1, p, owner, 5000000L);
        String reqId2 = requestFinalization(buyer2, p, owner, 5500000L);

        // Pre-close the deal directly via JDBC so the service call will fail.
        jdbc.update("INSERT INTO deals (id, property_id, deal, status) VALUES (?, ?, 'rent', 'closed')",
                UUID.randomUUID(), p.getId());

        // Attempt to accept â€” should fail (deal already closed cannot transition to closed again).
        mvc.perform(post("/finalization/requests/" + reqId1 + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict());

        // Assert: both requests remain pending â€” nothing committed.
        assertThat(finalizationRepo.findById(UUID.fromString(reqId1)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.PENDING);
        assertThat(finalizationRepo.findById(UUID.fromString(reqId2)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.PENDING);
    }

    // ---- Â§11 test 6: initiator attempting to accept own request â†’ 403, row stays pending ----

    @Test
    void initiatorCannotAcceptOwnRequest() throws Exception {
        User owner = user("9830100014", "owner");
        User buyer = user("9830100015", "buyer");
        Property p = listing(owner, "Self-accept test");

        String reqId = requestFinalization(buyer, p, owner, 5000000L);

        mvc.perform(post("/finalization/requests/" + reqId + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());

        assertThat(finalizationRepo.findById(UUID.fromString(reqId)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.PENDING);
    }

    // ---- Â§11 test 7: complete stranger â†’ 404 each ----

    @Test
    void stranger_allOperations_return404() throws Exception {
        User owner = user("9830100016", "owner");
        User buyer = user("9830100017", "buyer");
        User stranger = user("9830100018", "buyer");
        Property p = listing(owner, "Stranger test");

        String reqId = requestFinalization(buyer, p, owner, 5000000L);

        // accept
        mvc.perform(post("/finalization/requests/" + reqId + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound());

        // decline
        mvc.perform(post("/finalization/requests/" + reqId + "/decline")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isNotFound());

        // status (stranger is not a participant on this property)
        mvc.perform(get("/finalization/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        // cancel (stranger is not a participant)
        mvc.perform(delete("/finalization/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    // ---- Â§11 test 8: cancel â†’ 204, status='cancelled', row still physically exists ----

    @Test
    void cancelFinalization_returns204_softTransition() throws Exception {
        User owner = user("9830100019", "owner");
        User buyer = user("9830100020", "buyer");
        Property p = listing(owner, "Cancel test");

        String reqId = requestFinalization(buyer, p, owner, 5000000L);

        mvc.perform(delete("/finalization/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isNoContent());

        // Verify via JdbcTemplate the row still physically exists and is cancelled.
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM finalization_requests WHERE id = ?::uuid AND status = 'cancelled'",
                Integer.class, reqId);
        assertThat(count).isEqualTo(1);
    }

    // ---- Â§11 test 9: /me/finalization-requests returns only caller's requests ----

    @Test
    void myFinalizationRequests_returnsOnlyCallersRequests() throws Exception {
        User owner1 = user("9830100021", "owner");
        User owner2 = user("9830100022", "owner");
        User buyer = user("9830100023", "buyer");
        Property p1 = listing(owner1, "My req 1");
        Property p2 = listing(owner2, "My req 2");

        requestFinalization(buyer, p1, owner1, 5000000L);
        requestFinalization(buyer, p2, owner2, 6000000L);

        // owner1 sees only the request where they are the counterparty.
        mvc.perform(get(Routes.Finalization.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].propertyId").value(p1.getId().toString()));

        // owner2 sees only their own.
        mvc.perform(get(Routes.Finalization.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].propertyId").value(p2.getId().toString()));
    }

    // ---- Â§11 test 10: mobile masking â€” masked while pending, revealed on accepted ----

    @Test
    void mobileMasking_maskedWhilePending_revealedOnAccepted() throws Exception {
        User owner = user("9830100024", "owner");
        User buyer = user("9876543210", "buyer");
        Property p = listing(owner, "Mask test");

        requestFinalization(buyer, p, owner, 5000000L);

        // Owner views status â€” buyer's mobile should be masked.
        MvcResult pendingResult = mvc.perform(get("/finalization/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.initiator.mobile").value("98XXXXX210"))
                .andReturn();

        // Now accept.
        String reqId = extractId(pendingResult);
        mvc.perform(post("/finalization/requests/" + reqId + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());

        // After acceptance, query the DB and verify with a fresh projection.
        FinalizationRequest accepted = finalizationRepo.findById(UUID.fromString(reqId)).orElseThrow();
        assertThat(accepted.getStatus()).isEqualTo(FinalizationStatuses.ACCEPTED);
        // The mobile is revealed in the DTO (we re-project manually since the live status
        // endpoint only shows pending requests).
        User buyerUser = users.findById(buyer.getId()).orElseThrow();
        FinalizationRequestDto dto = FinalizationMapper.toDto(
                accepted, buyerUser, owner, owner.getId());
        assertThat(dto.initiator().mobile()).isEqualTo("9876543210");
    }

    // ---- Â§11 test 11: duplicate live request â†’ 409 ----

    @Test
    void duplicateLiveRequest_returns409() throws Exception {
        User owner = user("9830100025", "owner");
        User buyer = user("9830100026", "buyer");
        Property p = listing(owner, "Duplicate test");

        requestFinalization(buyer, p, owner, 5000000L);

        // Second attempt should conflict.
        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + owner.getMobile()
                                + "\",\"agreedPrice\":6000000}"))
                .andExpect(status().isConflict());
    }

    // ---- Â§11 test 12: illegal transition â€” accept already declined â†’ 409 ----

    @Test
    void illegalTransition_acceptDeclinedRequest_returns409() throws Exception {
        User owner = user("9830100027", "owner");
        User buyer = user("9830100028", "buyer");
        Property p = listing(owner, "Illegal transition");

        String reqId = requestFinalization(buyer, p, owner, 5000000L);

        // Owner declines first.
        mvc.perform(post("/finalization/requests/" + reqId + "/decline")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());

        // Attempt to accept the now-declined request â†’ 409.
        mvc.perform(post("/finalization/requests/" + reqId + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict());
    }

    // ---- Â§11 test 13: money round-trip â€” large value survives as long ----

    @Test
    void moneyRoundTrips_largeValueNoPrecisionLoss() throws Exception {
        User owner = user("9830100029", "owner");
        User buyer = user("9830100030", "buyer");
        Property p = listing(owner, "Money test");
        long largeAmount = 25_00_00_000L; // 25 crore

        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + owner.getMobile()
                                + "\",\"agreedPrice\":" + largeAmount + "}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.agreedPrice").value(largeAmount));
    }

    // ---- Â§11 test 14: route-constant â†” SecurityConfig agreement ----

    @Test
    void everyFinalizationRouteConstantIsServedByAController() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        assertThat(mapped).contains(
                Routes.Finalization.REQUEST,
                Routes.Finalization.STATUS,
                Routes.Finalization.ME_REQUESTS,
                Routes.Finalization.ACCEPT,
                Routes.Finalization.DECLINE);
    }
    // ---- Regression: the counterparty is derived from the listing, not the request body ----
    //
    // The first cut resolved the counterparty by looking up whatever mobile arrived in the body,
    // checking only that it belonged to *some* registered user. That let a buyer aim a
    // finalization request at any account on the platform -- filling a stranger's inbox with
    // proposals about a listing that was nothing to do with them -- and turned the endpoint into
    // an account-enumeration oracle, on a platform where a registered mobile is exactly the thing
    // worth harvesting.

    @Test
    void cannotAimAFinalizationRequestAtSomeoneWhoIsNotTheOwner() throws Exception {
        User owner = user("9820100091", "owner");
        User buyer = user("9820100092", "buyer");
        User bystander = user("9820100093", "buyer");
        Property p = listing(owner, "Inbox pollution test");

        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + bystander.getMobile()
                                + "\",\"agreedPrice\":5000000}"))
                .andExpect(status().isBadRequest());

        // The bystander's inbox stays empty.
        mvc.perform(get(Routes.Finalization.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(bystander)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    /**
     * An unregistered mobile and a registered-but-wrong one must be indistinguishable, otherwise
     * the endpoint answers "does this number have an account?" for any number the caller likes.
     */
    @Test
    void wrongMobileAndUnregisteredMobileAreIndistinguishable() throws Exception {
        User owner = user("9820100094", "owner");
        User buyer = user("9820100095", "buyer");
        User registeredStranger = user("9820100096", "buyer");
        Property p = listing(owner, "Enumeration oracle test");

        String registeredBody = "{\"counterpartyMobile\":\"" + registeredStranger.getMobile()
                + "\",\"agreedPrice\":5000000}";
        String unregisteredBody = "{\"counterpartyMobile\":\"9000000000\",\"agreedPrice\":5000000}";

        String registeredResponse = mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON).content(registeredBody))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        String unregisteredResponse = mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON).content(unregisteredBody))
                .andExpect(status().isBadRequest())
                .andReturn().getResponse().getContentAsString();

        // Compare the caller-visible parts only. traceId is per-request by design.
        assertThat(messageOf(registeredResponse)).isEqualTo(messageOf(unregisteredResponse));
        assertThat(errorOf(registeredResponse)).isEqualTo(errorOf(unregisteredResponse));
    }

    private static String messageOf(String json) {
        return json.replaceAll("^.*\"message\":\"([^\"]*)\".*$", "$1");
    }

    private static String errorOf(String json) {
        return json.replaceAll("^.*\"error\":\"([^\"]*)\".*$", "$1");
    }
}