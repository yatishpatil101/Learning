package com.punenest.api.deals.deal;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.web.Routes;
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
 * Contract + behaviour proof for the deals sub-slice (A2), driven through the real filter chain
 * against the live Flyway'd Postgres under {@code ddl-auto=validate}.
 *
 * <p>Covers all 15 tests in the §11 bar: synthesized active, non-owner 404, reserve, off-platform
 * close, on-platform close, close fields, non-owner write 404, illegal transition 409, addParty
 * auto-reserve, addParty on closed 409, removeParty soft-delete, removeParty stable ids, myDeals
 * scoping, closed-deal blocks offers regression, route-constant agreement.
 */
class DealEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired DealRepository dealRepo;
    @Autowired DealPartyRepository partyRepo;
    @Autowired JdbcTemplate jdbc;
    @Autowired
    @org.springframework.beans.factory.annotation.Qualifier("requestMappingHandlerMapping")
    RequestMappingHandlerMapping handlerMapping;

    // ---- helpers ----

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Test User " + mobile.substring(6));
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

    private String dealPath(Property p) {
        return "/me/deals/" + p.getId();
    }

    // ---- §11 test 1: GET /me/deals/{propId} with no stored row → 200, synthesized active ----

    @Test
    void getDeal_noStoredRow_returnsSynthesizedActive() throws Exception {
        User owner = user("9820200001", "owner");
        Property p = listing(owner, "Synthesized test");

        mvc.perform(get(dealPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(DealStatuses.ACTIVE))
                .andExpect(jsonPath("$.propertyId").value(p.getId().toString()))
                .andExpect(jsonPath("$.deal").value("rent"))
                .andExpect(jsonPath("$.counterparty").doesNotExist())
                .andExpect(jsonPath("$.agreedPrice").doesNotExist());
    }

    // ---- §11 test 2: GET /me/deals/{propId} for a property the caller does not own → 404, not 403 ----

    @Test
    void getDeal_nonOwner_returns404() throws Exception {
        User owner = user("9820200002", "owner");
        User stranger = user("9820200003", "buyer");
        Property p = listing(owner, "Non-owner test");

        mvc.perform(get(dealPath(p))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not_found"));
    }

    // ---- §11 test 3: reserve → status reserved; row stored; property status unchanged ----

    @Test
    void reserve_createsReservedDeal_propertyStatusUnchanged() throws Exception {
        User owner = user("9820200004", "owner");
        Property p = listing(owner, "Reserve test");
        String originalStatus = p.getStatus();

        mvc.perform(post(dealPath(p) + "/reserve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());

        Deal deal = dealRepo.findByPropertyId(p.getId()).orElseThrow();
        assertThat(deal.getStatus()).isEqualTo(DealStatuses.RESERVED);

        // Moderation status must NOT change — a reserved listing is still live (D4/D110).
        Property reloaded = properties.findById(p.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(originalStatus);
        // D110: the public deal_status mirror moves to reserved so buyers badge "under offer".
        assertThat(reloaded.getDealStatus()).isEqualTo(DealStatuses.RESERVED);
    }

    // ---- §11 test 4: close with off-platform mobile → 200, counterparty_mobile stored, counterparty_id null ----

    @Test
    void close_offPlatformMobile_storedWithNullCounterpartyId() throws Exception {
        User owner = user("9820200005", "owner");
        Property p = listing(owner, "Off-platform close");

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\"}"))
                .andExpect(status().isOk());

        Deal deal = dealRepo.findByPropertyId(p.getId()).orElseThrow();
        assertThat(deal.getCounterpartyMobile()).isEqualTo("9876543210");
        assertThat(deal.getCounterpartyId()).isNull();
        assertThat(deal.getStatus()).isEqualTo(DealStatuses.CLOSED);
    }

    // ---- §11 test 5: close with a mobile that resolves → counterparty_id populated ----

    @Test
    void close_registeredMobile_counterpartyIdPopulated() throws Exception {
        User owner = user("9820200006", "owner");
        User buyer = user("9820200007", "buyer");
        Property p = listing(owner, "On-platform close");

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":7000000,\"counterpartyMobile\":\""
                                + buyer.getMobile() + "\"}"))
                .andExpect(status().isOk());

        Deal deal = dealRepo.findByPropertyId(p.getId()).orElseThrow();
        assertThat(deal.getCounterpartyId()).isEqualTo(buyer.getId());
        assertThat(deal.getCounterpartyMobile()).isEqualTo(buyer.getMobile());
    }

    // ---- §11 test 6: close → closedAt set, status closed, agreedPrice stored as long ----

    @Test
    void close_setsClosedAtAndAgreedPrice_largeValueSurvives() throws Exception {
        User owner = user("9820200008", "owner");
        Property p = listing(owner, "Close fields test");
        long largeAmount = 25_00_00_000L; // 25 crore

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":" + largeAmount
                                + ",\"counterpartyMobile\":\"9876543299\"}"))
                .andExpect(status().isOk());

        Deal deal = dealRepo.findByPropertyId(p.getId()).orElseThrow();
        assertThat(deal.getClosedAt()).isNotNull();
        assertThat(deal.getStatus()).isEqualTo(DealStatuses.CLOSED);
        assertThat(deal.getAgreedPrice()).isEqualTo(largeAmount);

        // D110: closing publishes the listing as terminal. The fixture is a rent listing, so
        // moderation status becomes rented (dropping it from the approved-floored search) and
        // the public deal_status mirror becomes closed (so a direct-link buyer sees the badge).
        Property reloaded = properties.findById(p.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(PropertyStatus.RENTED);
        assertThat(reloaded.getDealStatus()).isEqualTo(DealStatuses.CLOSED);
    }

    // ---- §11 test 7: non-owner attempting reserve/close/reopen → 404 each ----

    @Test
    void nonOwner_reserveCloseReopen_each404() throws Exception {
        User owner = user("9820200009", "owner");
        User stranger = user("9820200010", "buyer");
        Property p = listing(owner, "Non-owner write");

        mvc.perform(post(dealPath(p) + "/reserve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\"}"))
                .andExpect(status().isNotFound());

        mvc.perform(post(dealPath(p) + "/reopen")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    // ---- §11 test 8: illegal transition → 409, not 500 ----

    @Test
    void illegalTransition_reopenActiveDeal_returns409() throws Exception {
        User owner = user("9820200011", "owner");
        Property p = listing(owner, "Illegal transition");

        // No stored row = active. Reopen active → illegal.
        // But reopen needs a stored row to transition from. Since there is no row,
        // the service returns 409 (cannot reopen an active deal).
        mvc.perform(post(dealPath(p) + "/reopen")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"));
    }

    @Test
    void illegalTransition_closeAlreadyClosed_returns409() throws Exception {
        User owner = user("9820200012", "owner");
        Property p = listing(owner, "Double close");

        // Close first.
        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\"}"))
                .andExpect(status().isOk());

        // Try closing again.
        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":6000000,\"counterpartyMobile\":\"9876543211\"}"))
                .andExpect(status().isConflict());
    }

    // ---- §11 test 9: addParty on active deal → 201, deal becomes reserved ----

    @Test
    void addParty_activeDeal_createsPartyAndAutoReserves() throws Exception {
        User owner = user("9820200013", "owner");
        Property p = listing(owner, "Auto-reserve test");

        mvc.perform(post(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Raj Patel\",\"mobile\":\"9876000001\",\"note\":\"Visited today\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Raj Patel"))
                .andExpect(jsonPath("$.mobile").value("9876000001"))
                .andExpect(jsonPath("$.note").value("Visited today"))
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.at").isNotEmpty());

        // Deal must now be reserved.
        Deal deal = dealRepo.findByPropertyId(p.getId()).orElseThrow();
        assertThat(deal.getStatus()).isEqualTo(DealStatuses.RESERVED);
    }

    // ---- §11 test 10: addParty on closed deal → 409 ----

    @Test
    void addParty_closedDeal_returns409() throws Exception {
        User owner = user("9820200014", "owner");
        Property p = listing(owner, "Closed party test");

        // Close the deal first.
        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\"}"))
                .andExpect(status().isOk());

        mvc.perform(post(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Some Person\"}"))
                .andExpect(status().isConflict());
    }

    // ---- Q1 / D23a: input is lenient (normalised at the edge), storage stays strict ----

    @Test
    void close_countryCodePrefix_acceptedAndNormalised() throws Exception {
        User owner = user("9820200023", "owner");
        Property p = listing(owner, "Country code close");

        // 12 digits with a +91 country code. @IndianMobile normalises this to ten before it reaches
        // the deal (Q1), so the close now succeeds where the strict pattern used to 422 it.
        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"919876543210\"}"))
                .andExpect(status().isOk());

        assertThat(dealRepo.findByPropertyId(p.getId())
                .map(Deal::getStatus)
                .orElse(DealStatuses.ACTIVE))
                .isEqualTo(DealStatuses.CLOSED);
    }

    @Test
    void close_wrongLeadingDigit_rejected() throws Exception {
        User owner = user("9820200025", "owner");
        Property p = listing(owner, "Landline close");

        // A landline-style leading digit is still refused: ten digits is not enough, an Indian
        // mobile must start 6-9. @IndianMobile gates the normalised value against the stored shape,
        // so this is a 422 even though it strips to ten digits.
        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"2012345678\"}"))
                .andExpect(status().isUnprocessableEntity());

        assertThat(dealRepo.findByPropertyId(p.getId())
                .map(Deal::getStatus)
                .orElse(DealStatuses.ACTIVE))
                .isNotEqualTo(DealStatuses.CLOSED);
    }

    @Test
    void addParty_offContractMobile_rejectedRatherThanStoredUnmaskable() throws Exception {
        User owner = user("9820200024", "owner");
        Property p = listing(owner, "Loose mobile party");

        // addParty stores the mobile without normalising it, so before D23a a 15-digit number was
        // persisted verbatim -- and MobileMask.mask() answers null for anything that is not exactly
        // ten digits, so every masked read of it would have come back empty.
        mvc.perform(post(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Raj Patel\",\"mobile\":\"987654321012345\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    // ---- §11 test 11: removeParty → 204, soft-deleted, disappears from listParties ----

    @Test
    void removeParty_softDeletes_disappearsFromList() throws Exception {
        User owner = user("9820200015", "owner");
        Property p = listing(owner, "Remove party test");

        // Add a party (auto-reserves).
        MvcResult result = mvc.perform(post(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"To Remove\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String partyId = extractJsonField(result, "id");

        // Remove it.
        mvc.perform(delete(dealPath(p) + "/parties/" + partyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        // Assert soft-deleted (deleted_at IS NOT NULL) and row still physically exists.
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM deal_parties WHERE id = ?::uuid AND deleted_at IS NOT NULL",
                Integer.class, partyId);
        assertThat(count).isEqualTo(1);

        // Disappears from listParties.
        mvc.perform(get(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---- §11 test 12: removeParty unknown/foreign → 404; stable ids ----

    @Test
    void removeParty_unknownId_returns404() throws Exception {
        User owner = user("9820200016", "owner");
        Property p = listing(owner, "Unknown party");

        // Reserve the deal so it has a row.
        mvc.perform(post(dealPath(p) + "/reserve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());

        mvc.perform(delete(dealPath(p) + "/parties/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    @Test
    void removeParty_stableIds_otherPartiesKeepTheirIds() throws Exception {
        User owner = user("9820200017", "owner");
        Property p = listing(owner, "Stable ids test");

        // Add three parties.
        MvcResult r1 = mvc.perform(post(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Party A\"}"))
                .andExpect(status().isCreated()).andReturn();
        String idA = extractJsonField(r1, "id");

        MvcResult r2 = mvc.perform(post(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Party B\"}"))
                .andExpect(status().isCreated()).andReturn();
        String idB = extractJsonField(r2, "id");

        MvcResult r3 = mvc.perform(post(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Party C\"}"))
                .andExpect(status().isCreated()).andReturn();
        String idC = extractJsonField(r3, "id");

        // Remove the middle one.
        mvc.perform(delete(dealPath(p) + "/parties/" + idB)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        // The other two keep their original ids.
        mvc.perform(get(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].id").value(idA))
                .andExpect(jsonPath("$[0].name").value("Party A"))
                .andExpect(jsonPath("$[1].id").value(idC))
                .andExpect(jsonPath("$[1].name").value("Party C"));
    }

    // ---- §11 test 13: GET /me/deals returns only deals on the caller's own listings ----

    @Test
    void myDeals_returnsOnlyOwnListings() throws Exception {
        User owner1 = user("9820200018", "owner");
        User owner2 = user("9820200019", "owner");
        Property p1 = listing(owner1, "Owner1 listing");
        Property p2 = listing(owner2, "Owner2 listing");

        // Reserve both.
        mvc.perform(post(dealPath(p1) + "/reserve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner1)))
                .andExpect(status().isOk());
        mvc.perform(post(dealPath(p2) + "/reserve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner2)))
                .andExpect(status().isOk());

        // Owner1 should only see their own.
        mvc.perform(get(Routes.Deals.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].propertyId").value(p1.getId().toString()));
    }

    // ---- §11 test 14: closed deal blocks new offers (A1 regression) ----

    @Test
    void closedDeal_blocksNewOffers_a1Regression() throws Exception {
        User owner = user("9820200020", "owner");
        User buyer = user("9820200021", "buyer");
        Property p = listing(owner, "Offer-block regression");

        // Close the deal.
        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543299\"}"))
                .andExpect(status().isOk());

        // Buyer tries to submit an offer → should be blocked (409).
        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":5000000}"))
                .andExpect(status().isConflict());
    }

    // ---- §11 test 15: route-constant ↔ SecurityConfig matcher agreement ----

    @Test
    void everyDealRouteConstantIsServedByAController() {
        Set<String> mapped = handlerMapping.getHandlerMethods().keySet().stream()
                .filter(info -> info.getPathPatternsCondition() != null)
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .collect(Collectors.toSet());

        assertThat(mapped).contains(
                Routes.Deals.BASE,
                Routes.Deals.BY_PROP,
                Routes.Deals.RESERVE,
                Routes.Deals.CLOSE,
                Routes.Deals.REOPEN,
                Routes.Deals.PARTIES,
                Routes.Deals.PARTY_BY_ID);
    }

    // ---- Additional: reopen clears close-time fields ----

    @Test
    void reopen_clearsCloseTimeFields() throws Exception {
        User owner = user("9820200022", "owner");
        Property p = listing(owner, "Reopen clear test");

        // Close.
        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\",\"note\":\"Done\"}"))
                .andExpect(status().isOk());

        // Reopen.
        mvc.perform(post(dealPath(p) + "/reopen")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());

        Deal deal = dealRepo.findByPropertyId(p.getId()).orElseThrow();
        assertThat(deal.getStatus()).isEqualTo(DealStatuses.ACTIVE);
        assertThat(deal.getClosedAt()).isNull();
        assertThat(deal.getAgreedPrice()).isNull();
        assertThat(deal.getCounterpartyId()).isNull();
        assertThat(deal.getCounterpartyMobile()).isNull();
        assertThat(deal.getNote()).isNull();
    }

    // ---- helper ----

    private static String extractJsonField(MvcResult result, String field) throws Exception {
        String json = result.getResponse().getContentAsString();
        // Simple extraction for a top-level string field.
        return json.replaceAll("^.*?\"" + field + "\":\"([^\"]+)\".*$", "$1");
    }
}
