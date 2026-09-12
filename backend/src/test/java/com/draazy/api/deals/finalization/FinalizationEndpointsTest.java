package com.draazy.api.deals.finalization;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.deals.deal.DealStatuses;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtService;
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
 * <p>Covers every test in the §11 bar: request with registered counterparty, unregistered mobile,
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

    // ---- §11 test 1: request with a registered counterparty → 200, row stored pending ----

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

    // ---- §11 test 2: unregistered mobile → 422 ----

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

    // ---- §11 test 3: body propertyId mismatching path → 400 (S4) ----

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

    // ---- §11 test 4: auto-decline — three requests, accept one → siblings declined, deal closed ----

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

    // ---- §11 test 5: atomicity — force deal close failure → nothing committed ----

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

        // Attempt to accept — should fail (deal already closed cannot transition to closed again).
        mvc.perform(post("/finalization/requests/" + reqId1 + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict());

        // Assert: both requests remain pending — nothing committed.
        assertThat(finalizationRepo.findById(UUID.fromString(reqId1)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.PENDING);
        assertThat(finalizationRepo.findById(UUID.fromString(reqId2)).orElseThrow().getStatus())
                .isEqualTo(FinalizationStatuses.PENDING);
    }

    // ---- §11 test 6: initiator attempting to accept own request → 403, row stays pending ----

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

    // ---- §11 test 7: complete stranger → 404 each ----

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

    // ---- §11 test 8: cancel → 204, status='cancelled', row still physically exists ----

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

    // ---- §11 test 8b: declined request stays readable via status (D111) ----

    @Test
    void statusAfterDecline_returnsDeclinedRow() throws Exception {
        User owner = user("9830100031", "owner");
        User buyer = user("9830100032", "buyer");
        Property p = listing(owner, "Declined status test");

        String reqId = requestFinalization(buyer, p, owner, 5000000L);

        // Owner declines the request.
        mvc.perform(post("/finalization/requests/" + reqId + "/decline")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());

        // Buyer reads status — previously 404 (pending-only), now returns the declined row so the
        // property page can explain the refusal and offer to ask again.
        mvc.perform(get("/finalization/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(FinalizationStatuses.DECLINED));
    }

    // ---- §11 test 9: /me/finalization-requests returns only caller's requests ----

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
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(p1.getId().toString()));

        // owner2 sees only their own.
        mvc.perform(get(Routes.Finalization.ME_REQUESTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(p2.getId().toString()));
    }

    // ---- D77: the counterparty inbox is paged, and its count query agrees with its read query ----

    /**
     * {@code findPendingByCounterparty} is the one paged finder here that carries a hand-written
     * {@code countQuery}, so its read and its count are two separate pieces of JPQL that can drift.
     * If they do, the drift is silent: the rows are right and only {@code totalElements} lies, which
     * is precisely the number a "3 waiting on you" badge renders.
     *
     * <p>The declined row is the trap. It must be counted by neither half — a count query that
     * dropped the {@code status = 'pending'} predicate would still return the correct page and an
     * inflated total, and no assertion on {@code content} alone would notice.
     */
    @Test
    void myFinalizationRequests_isPaged_andTheTotalCountsOnlyPendingRows() throws Exception {
        User owner = user("9830100040", "owner");
        Property p1 = listing(owner, "Fin paging A");
        Property p2 = listing(owner, "Fin paging B");
        Property p3 = listing(owner, "Fin paging C");
        Property p4 = listing(owner, "Fin paging D");
        // One request per property: `uq_finalization_live_per_user_property` forbids a second live
        // request from the same initiator on the same listing.
        requestFinalization(user("9830100041", "buyer"), p1, owner, 5000000L);
        requestFinalization(user("9830100042", "buyer"), p2, owner, 5100000L);
        requestFinalization(user("9830100043", "buyer"), p3, owner, 5200000L);
        String declined = requestFinalization(user("9830100044", "buyer"), p4, owner, 5300000L);
        mvc.perform(post("/finalization/requests/" + declined + "/decline")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Finalization.ME_REQUESTS).param("page", "0").param("size", "2")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2));

        mvc.perform(get(Routes.Finalization.ME_REQUESTS).param("page", "1").param("size", "2")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    // ---- §11 test 10: mobile masking — masked while pending, stays masked to counterparty once accepted ----

    @Test
    void mobileMasking_staysMaskedToCounterparty_evenOnceAccepted() throws Exception {
        User owner = user("9830100024", "owner");
        User buyer = user("9876543210", "buyer");
        Property p = listing(owner, "Mask test");

        requestFinalization(buyer, p, owner, 5000000L);

        // Owner views status — buyer's mobile should be masked.
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
        // D5 (global policy): the counterparty's mobile stays masked even once accepted. Re-projected
        // directly here with the owner as viewer to assert the masking in isolation.
        User buyerUser = users.findById(buyer.getId()).orElseThrow();
        FinalizationRequestDto dto = FinalizationMapper.toDto(
                accepted, buyerUser, owner, owner.getId(), Set.of());
        assertThat(dto.initiator().mobile()).isEqualTo("98XXXXX210");
    }

    // ---- §11 test 11: duplicate live request → 409 ----

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

    // ---- §11 test 12: illegal transition — accept already declined → 409 ----

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

        // Attempt to accept the now-declined request → 409.
        mvc.perform(post("/finalization/requests/" + reqId + "/accept")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict());
    }

    // ---- §11 test 13: money round-trip — large value survives as long ----

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

    // ---- §11 test 14: route-constant ↔ SecurityConfig agreement ----

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
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(0));
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