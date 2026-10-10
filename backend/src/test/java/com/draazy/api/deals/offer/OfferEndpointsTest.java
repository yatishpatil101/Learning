package com.draazy.api.deals.offer;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtService;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

class OfferEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired OfferRepository offerRepo;
    @Autowired OfferHistoryRepository historyRepo;
    @Autowired JdbcTemplate jdbc;

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
        User otherBuyer = user("9820100052", "buyer");
        Property p = listing(owner, "Submit test");
        long largeAmount = 3_000_000_000L;

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":" + largeAmount + "}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$.amount").value(largeAmount))
                .andExpect(jsonPath("$.status").value(OfferStatuses.PENDING))
                .andExpect(jsonPath("$.from.role").value("buyer"))
                .andExpect(jsonPath("$.from.id").value(buyer.getId().toString()))
                .andExpect(jsonPath("$.history.length()").value(1))
                .andExpect(jsonPath("$.history[0].by").value("buyer"))
                .andExpect(jsonPath("$.history[0].amount").value(largeAmount))
                .andExpect(jsonPath("$.moveIn").value(org.hamcrest.Matchers.nullValue()));

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(otherBuyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId()
                                + "\",\"amount\":5000000,\"moveIn\":\"2026-03-15\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.moveIn").value("2026-03-15"));
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
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].amount").value(5000000));
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
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].propertyId").value(p1.getId().toString()));
    }

    // ---- §11 test 9: Buyer's mobile masked on pending, stays masked to the owner once accepted ----

    @Test
    void buyerMobile_staysMaskedToOwner_evenAfterAccepted() throws Exception {
        User owner = user("9820100020", "owner");
        User buyer = user("9829876543", "buyer");
        Property p = listing(owner, "Mask test");
        String offerId = submitOffer(buyer, p, 5000000);

        // Owner views offers on their listings — buyer mobile should be masked.
        mvc.perform(get(Routes.Offers.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].from.mobile").value("98XXXXX543"));

        // Accept the offer.
        respond(owner, offerId, "accept", null, null);

        // After acceptance, buyer mobile should be revealed.
        mvc.perform(get(Routes.Offers.ME)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].from.mobile").value("98XXXXX543"));
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


    /** Asserts {@code totalElements}, not {@code content.length()}: a count derived from the page is right
     * for every owner until the first one gets popular. */
    @Test
    void offersOnMine_isPaged_andTotalCountsTheWholeBookNotThePage() throws Exception {
        User owner = user("9820100040", "owner");
        Property p1 = listing(owner, "Paging A");
        Property p2 = listing(owner, "Paging B");
        Property p3 = listing(owner, "Paging C");
        // One offer per property: `uq_offers_live_per_user_property` forbids a buyer stacking two
        // live offers on one listing, so three rows need three listings, not three amounts.
        submitOffer(user("9820100041", "buyer"), p1, 5000000);
        submitOffer(user("9820100042", "buyer"), p2, 5100000);
        submitOffer(user("9820100043", "buyer"), p3, 5200000);

        mvc.perform(get(Routes.Offers.ME).param("page", "0").param("size", "2")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2));

        mvc.perform(get(Routes.Offers.ME).param("page", "1").param("size", "2")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    /** A client sort must be ignored: an unknown {@code ?sort=} property otherwise reaches the JPA query
     * and becomes a 500 any signed-in caller can trigger by guessing. */
    @Test
    void offersOnMine_ignoresAClientSuppliedSort_ratherThanFailingOnAnUnknownField() throws Exception {
        User owner = user("9820100044", "owner");
        Property p = listing(owner, "Sort strip");
        submitOffer(user("9820100045", "buyer"), p, 5000000);

        mvc.perform(get(Routes.Offers.ME).param("sort", "notAColumn,desc")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.sort").doesNotExist());
    }

    // Accept/decline are the owner's decision alone: a participant-only check lets the buyer accept their own
    // offer, agreeing a price with no owner and flipping the status that drives the mobile reveal.

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


    private List<Map<String, Object>> notificationsFor(User u) {
        return jdbc.queryForList(
                "select type, title, body, link from notifications where user_id = ?", u.getId());
    }

    @Test
    void submitOffer_notifiesOwnerNotBuyer() throws Exception {
        User owner = user("9820100037", "owner");
        User buyer = user("9820100038", "buyer");
        Property p = listing(owner, "Offer notify test");

        submitOffer(buyer, p, 4_100_000L);

        assertThat(notificationsFor(owner)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("offer.received");
            assertThat(row.get("link")).isEqualTo("/property/" + p.getId());
            assertThat((String) row.get("title")).contains("Offer notify test");
            assertThat((String) row.get("body")).contains("\u20b941,00,000");
            // D5/Q2: the amount and the buyer's display name are fair game, the mobile is not.
            assertThat((String) row.get("body")).doesNotContain(buyer.getMobile());
        });

        // Submitting is the buyer's own action.
        assertThat(notificationsFor(buyer)).isEmpty();
    }

    @Test
    void ownerCounters_notifiesTheBuyer() throws Exception {
        User owner = user("9820100039", "owner");
        User buyer = user("9820100040", "buyer");
        Property p = listing(owner, "Counter notify test");
        String offerId = submitOffer(buyer, p, 4_000_000L);

        respond(owner, offerId, "counter", 4_500_000L, null);

        assertThat(notificationsFor(buyer)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("offer.countered");
            assertThat(row.get("link")).isEqualTo("/property/" + p.getId());
            assertThat((String) row.get("body")).contains("The owner", "\u20b945,00,000")
                    .doesNotContain(owner.getMobile());
        });
        assertThat(notificationsFor(owner)).extracting(row -> row.get("type"))
                .containsExactly("offer.received");
    }

    @Test
    void buyerCounters_notifiesTheOwner() throws Exception {
        User owner = user("9820100090", "owner");
        User buyer = user("9820100091", "buyer");
        Property p = listing(owner, "Buyer counter notify");
        String offerId = submitOffer(buyer, p, 4_000_000L);
        respond(owner, offerId, "counter", 4_500_000L, null);

        respond(buyer, offerId, "counter", 4_200_000L, null);

        assertThat(notificationsFor(owner)).extracting(row -> row.get("type"))
                .containsExactlyInAnyOrder("offer.received", "offer.countered");
        assertThat(notificationsFor(buyer)).hasSize(1);
    }

    @Test
    void ownerAccepts_notifiesTheBuyer() throws Exception {
        User owner = user("9820100092", "owner");
        User buyer = user("9820100093", "buyer");
        Property p = listing(owner, "Accept notify test");
        String offerId = submitOffer(buyer, p, 4_000_000L);

        respond(owner, offerId, "accept", null, null);

        assertThat(notificationsFor(buyer)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("offer.accepted");
            assertThat((String) row.get("body")).contains("\u20b940,00,000", "Accept notify test");
        });
        assertThat(notificationsFor(owner)).hasSize(1);
    }

    @Test
    void ownerDeclines_notifiesTheBuyerNotTheOwner() throws Exception {
        User owner = user("9820100094", "owner");
        User buyer = user("9820100095", "buyer");
        Property p = listing(owner, "Decline notify test");
        String offerId = submitOffer(buyer, p, 4_000_000L);

        respond(owner, offerId, "decline", null, null);

        assertThat(notificationsFor(buyer)).singleElement().satisfies(row -> {
            assertThat(row.get("type")).isEqualTo("offer.declined");
            assertThat(row.get("title")).isEqualTo("Your offer was declined");
            assertThat(row.get("body")).isEqualTo("The owner declined your offer on Decline notify test.");
            assertThat(row.get("link")).isEqualTo("/property/" + p.getId());
        });
        assertThat(notificationsFor(owner)).extracting(row -> row.get("type"))
                .containsExactly("offer.received");
    }
}