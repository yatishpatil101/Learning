package com.punenest.api.deals.offer;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import java.util.List;
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
 * Contract + behaviour proof for the offers sub-slice (A1), driven through the real filter chain
 * against the live Flyway'd Postgres under {@code ddl-auto=validate}.
 *
 * <p>Covers every test in the §11 bar: submit, counter, author-counter-back, accept, illegal
 * transition, third-party scoping, caller-scoped lists, mobile masking, duplicate prevention,
 * closed-deal block, route-constant agreement, and money round-trip.
 */
class OfferEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired OfferRepository offerRepo;
    @Autowired OfferHistoryRepository historyRepo;
    @Autowired JdbcTemplate jdbc;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    // ---- helpers ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Test User");
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

    private String submitOffer(User buyer, Property p, long amount) throws Exception {
        MvcResult result = mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":" + amount + "}"))
                .andExpect(status().isCreated())
                .andReturn();
        return result.getResponse().getContentAsString()
                .replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private void respond(User caller, String offerId, String action, Long counterAmount,
                          String message) throws Exception {
        StringBuilder body = new StringBuilder("{\"action\":\"" + action + "\"");
        if (counterAmount != null) body.append(",\"counterAmount\":").append(counterAmount);
        if (message != null) body.append(",\"message\":\"").append(message).append("\"");
        body.append("}");
        mvc.perform(post(Routes.Offers.BASE + "/" + offerId + "/respond")
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.toString()))
                .andExpect(status().isOk());
    }

    // ---- §11 test 1: Submit → 201, correct shape, history row with by='buyer' ----

    @Test
    void submitOffer_creates201WithHistoryRow() throws Exception {
        User owner = user("9820100001", "owner");
        User buyer = user("9820100002", "buyer");
        Property p = listing(owner, "Submit test");

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":5000000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$.amount").value(5000000))
                .andExpect(jsonPath("$.status").value(OfferStatuses.PENDING))
                .andExpect(jsonPath("$.from.role").value("buyer"))
                .andExpect(jsonPath("$.from.id").value(buyer.getId().toString()))
                .andExpect(jsonPath("$.history.length()").value(1))
                .andExpect(jsonPath("$.history[0].by").value("buyer"))
                .andExpect(jsonPath("$.history[0].amount").value(5000000));
    }

    /** D112: the buyer's preferred possession date round-trips as a `date`, not folded into message. */
    @Test
    void submitOffer_carriesMoveIn() throws Exception {
        User owner = user("9820100051", "owner");
        User buyer = user("9820100052", "buyer");
        Property p = listing(owner, "Move-in test");

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId()
                                + "\",\"amount\":5000000,\"moveIn\":\"2026-03-15\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.moveIn").value("2026-03-15"));
    }

    /** D112: `moveIn` is optional — an offer on price alone omits it and the field comes back absent. */
    @Test
    void submitOffer_moveInOptional() throws Exception {
        User owner = user("9820100053", "owner");
        User buyer = user("9820100054", "buyer");
        Property p = listing(owner, "No move-in test");

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":5000000}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.moveIn").value(org.hamcrest.Matchers.nullValue()));
    }

    // ---- §11 test 2: Owner counters → 'countered', history row with by='owner' ----

    @Test
    void ownerCounters_statusCountered_historyByOwner() throws Exception {
        User owner = user("9820100003", "owner");
        User buyer = user("9820100004", "buyer");
        Property p = listing(owner, "Counter test");
        String offerId = submitOffer(buyer, p, 5000000);

        respond(owner, offerId, "counter", 5500000L, null);

        Offer offer = offerRepo.findById(UUID.fromString(offerId)).orElseThrow();
        assertThat(offer.getStatus()).isEqualTo(OfferStatuses.COUNTERED);
        assertThat(offer.getAmount()).isEqualTo(5500000L);

        List<OfferHistory> trail = historyRepo.findByOfferIdOrderByAtAsc(offer.getId());
        assertThat(trail).hasSize(2);
        assertThat(trail.get(1).getBy()).isEqualTo("owner");
        assertThat(trail.get(1).getAmount()).isEqualTo(5500000L);
    }

    // ---- §11 test 3: Author counters back → history row with by='buyer' ----

    @Test
    void authorCountersBack_historyByBuyer() throws Exception {
        User owner = user("9820100005", "owner");
        User buyer = user("9820100006", "buyer");
        Property p = listing(owner, "Counter back test");
        String offerId = submitOffer(buyer, p, 5000000);

        respond(owner, offerId, "counter", 5500000L, null);
        respond(buyer, offerId, "counter", 5200000L, null);

        List<OfferHistory> trail = historyRepo.findByOfferIdOrderByAtAsc(
                UUID.fromString(offerId));
        assertThat(trail).hasSize(3);
        assertThat(trail.get(2).getBy()).isEqualTo("buyer");
        assertThat(trail.get(2).getAmount()).isEqualTo(5200000L);
    }

    // ---- §11 test 4: Owner accepts → 'accepted', NO new history row ----

    @Test
    void ownerAccepts_statusAccepted_noNewHistoryRow() throws Exception {
        User owner = user("9820100007", "owner");
        User buyer = user("9820100008", "buyer");
        Property p = listing(owner, "Accept test");
        String offerId = submitOffer(buyer, p, 5000000);

        respond(owner, offerId, "accept", null, null);

        Offer offer = offerRepo.findById(UUID.fromString(offerId)).orElseThrow();
        assertThat(offer.getStatus()).isEqualTo(OfferStatuses.ACCEPTED);

        List<OfferHistory> trail = historyRepo.findByOfferIdOrderByAtAsc(offer.getId());
        assertThat(trail).hasSize(1); // only the submit event
    }

    // ---- §11 test 5: Illegal transition → 409, not 500, not 422 ----

    @Test
    void illegalTransition_respondToAcceptedOffer_returns409() throws Exception {
        User owner = user("9820100009", "owner");
        User buyer = user("9820100010", "buyer");
        Property p = listing(owner, "Illegal transition");
        String offerId = submitOffer(buyer, p, 5000000);
        respond(owner, offerId, "accept", null, null);

        mvc.perform(post(Routes.Offers.BASE + "/" + offerId + "/respond")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"decline\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"));
    }

    // ---- §11 test 6: Third party responding → 404, not 403 ----

    @Test
    void thirdPartyResponding_returns404() throws Exception {
        User owner = user("9820100011", "owner");
        User buyer = user("9820100012", "buyer");
        User stranger = user("9820100013", "buyer");
        Property p = listing(owner, "Third party");
        String offerId = submitOffer(buyer, p, 5000000);

        mvc.perform(post(Routes.Offers.BASE + "/" + offerId + "/respond")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"accept\"}"))
                .andExpect(status().isNotFound());
    }

    // ---- §11 test 7: /offers/mine returns only the caller's own offers ----

    @Test
    void myOffers_returnsOnlyCallerOwn() throws Exception {
        User owner = user("9820100014", "owner");
        User buyer1 = user("9820100015", "buyer");
        User buyer2 = user("9820100016", "buyer");
        Property p = listing(owner, "Mine filter");
        submitOffer(buyer1, p, 5000000);
        submitOffer(buyer2, p, 6000000);

        mvc.perform(get(Routes.Offers.MINE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].amount").value(5000000));
    }

    // ---- §11 test 8: /me/offers returns only offers on the caller's listings ----

    @Test
    void offersOnMine_returnsOnlyCallersListings() throws Exception {
        User owner1 = user("9820100017", "owner");
        User owner2 = user("9820100018", "owner");
        User buyer = user("9820100019", "buyer");
        Property p1 = listing(owner1, "Owner1 flat");
        Property p2 = listing(owner2, "Owner2 flat");
        submitOffer(buyer, p1, 5000000);
        submitOffer(buyer, p2, 6000000);

        mvc.perform(get(Routes.Offers.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].propertyId").value(p1.getId().toString()));
    }

    // ---- §11 test 9: Buyer's mobile masked on pending, revealed on accepted ----

    @Test
    void buyerMobile_maskedOnPending_revealedOnAccepted() throws Exception {
        User owner = user("9820100020", "owner");
        User buyer = user("9829876543", "buyer");
        Property p = listing(owner, "Mask test");
        String offerId = submitOffer(buyer, p, 5000000);

        // Owner views offers on their listings — buyer mobile should be masked.
        mvc.perform(get(Routes.Offers.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].from.mobile").value("98XXXXX543"));

        // Accept the offer.
        respond(owner, offerId, "accept", null, null);

        // After acceptance, buyer mobile should be revealed.
        mvc.perform(get(Routes.Offers.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].from.mobile").value("9829876543"));
    }

    // ---- §11 test 10: Duplicate live offer → 409 (DB constraint) ----

    @Test
    void duplicateLiveOffer_returns409() throws Exception {
        User owner = user("9820100021", "owner");
        User buyer = user("9820100022", "buyer");
        Property p = listing(owner, "Duplicate test");
        submitOffer(buyer, p, 5000000);

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":6000000}"))
                .andExpect(status().isConflict());
    }

    /** §11 test 10 part 2: assert the DB constraint fires even if the service check is bypassed. */
    @Test
    void duplicateLiveOffer_dbConstraintFiresDirectly() {
        User owner = user("9820100023", "owner");
        User buyer = user("9820100024", "buyer");
        Property p = listing(owner, "Constraint test");

        Offer first = new Offer(p.getId(), buyer.getId(), 5000000L, null, null);
        offerRepo.saveAndFlush(first);

        Offer second = new Offer(p.getId(), buyer.getId(), 6000000L, null, null);
        org.junit.jupiter.api.Assertions.assertThrows(
                org.springframework.dao.DataIntegrityViolationException.class,
                () -> offerRepo.saveAndFlush(second));
    }

    // ---- §11 test 11: Offer on property with closed deal → 409 ----

    @Test
    void offerOnClosedDeal_returns409() throws Exception {
        User owner = user("9820100025", "owner");
        User buyer = user("9820100026", "buyer");
        Property p = listing(owner, "Closed deal");

        // Insert a closed deal directly via JDBC (DealRef is read-only, no public constructor).
        jdbc.update("INSERT INTO deals (id, property_id, deal, status) VALUES (?, ?, 'buy', 'closed')",
                UUID.randomUUID(), p.getId());

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":5000000}"))
                .andExpect(status().isConflict());
    }

    // ---- §11 test 12: Route-constant ↔ SecurityConfig matcher agreement ----

    @Test
    void everyOfferRouteConstantIsServedByAController() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        assertThat(mapped).contains(
                Routes.Offers.BASE,
                Routes.Offers.MINE,
                Routes.Offers.RESPOND,
                Routes.Offers.ME);
    }

    // ---- §11 test 13: Money round-trips as a long ----

    @Test
    void moneyRoundTrips_largeValueNoPrecisionLoss() throws Exception {
        User owner = user("9820100027", "owner");
        User buyer = user("9820100028", "buyer");
        Property p = listing(owner, "Money test");
        long largeAmount = 25_00_00_000L; // 25 crore

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":" + largeAmount + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.amount").value(largeAmount))
                .andExpect(jsonPath("$.history[0].amount").value(largeAmount));
    }
    // ---- Regression: accept/decline are the owner's decision alone ----
    //
    // The first cut of respond() checked only that the caller was *a* participant, which let the
    // buyer accept their own offer -- agreeing a price with no owner involvement, and flipping the
    // status that drives the mobile reveal. Participation is not authorisation.

    @Test
    void buyerCannotAcceptTheirOwnOffer() throws Exception {
        User owner = user("9820100031", "owner");
        User buyer = user("9820100032", "buyer");
        Property p = listing(owner, "Self-accept test");
        String offerId = submitOffer(buyer, p, 4_000_000L);

        mvc.perform(post(Routes.Offers.BASE + "/" + offerId + "/respond")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"accept\"}"))
                .andExpect(status().isForbidden());

        assertThat(offerRepo.findById(UUID.fromString(offerId)).orElseThrow().getStatus())
                .isEqualTo(OfferStatuses.PENDING);
    }

    @Test
    void buyerCannotDeclineTheirOwnOffer() throws Exception {
        User owner = user("9820100033", "owner");
        User buyer = user("9820100034", "buyer");
        Property p = listing(owner, "Self-decline test");
        String offerId = submitOffer(buyer, p, 4_000_000L);

        mvc.perform(post(Routes.Offers.BASE + "/" + offerId + "/respond")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"action\":\"decline\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void buyerMayStillCounter_negotiationIsTwoSided() throws Exception {
        User owner = user("9820100035", "owner");
        User buyer = user("9820100036", "buyer");
        Property p = listing(owner, "Two-sided counter test");
        String offerId = submitOffer(buyer, p, 4_000_000L);

        respond(owner, offerId, "counter", 4_500_000L, null);
        respond(buyer, offerId, "counter", 4_200_000L, null);

        assertThat(historyRepo.findByOfferIdInOrderByAtAsc(List.of(UUID.fromString(offerId))))
                .extracting(OfferHistory::getBy)
                .containsExactly(OfferStatuses.BY_BUYER, OfferStatuses.BY_OWNER,
                        OfferStatuses.BY_BUYER);
    }
}