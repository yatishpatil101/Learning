package com.draazy.api.deals.deal;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.moderation.verification.PropertyReview;
import com.draazy.api.moderation.verification.PropertyReviewRepository;
import com.draazy.api.security.JwtService;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

// Deals cross auth, listing ownership, and status transitions, so they use the real filter chain.
class DealEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired DealRepository dealRepo;
    @Autowired PropertyReviewRepository reviews;
    @Autowired JdbcTemplate jdbc;

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

        Property reloaded = properties.findById(p.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(originalStatus);

        assertThat(reloaded.getDealStatus()).isEqualTo(DealStatuses.RESERVED);
    }

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

    @Test
    void close_setsClosedAtAndAgreedPrice_largeValueSurvives() throws Exception {
        User owner = user("9820200008", "owner");
        Property p = listing(owner, "Close fields test");
        long largeAmount = 3_000_000_000L;

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

        Property reloaded = properties.findById(p.getId()).orElseThrow();
        assertThat(reloaded.getStatus()).isEqualTo(PropertyStatus.RENTED);
        assertThat(reloaded.getDealStatus()).isEqualTo(DealStatuses.CLOSED);
    }

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

    @Test
    void illegalTransition_reopenActiveDeal_returns409() throws Exception {
        User owner = user("9820200011", "owner");
        Property p = listing(owner, "Illegal transition");

        mvc.perform(post(dealPath(p) + "/reopen")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"));
    }

    @Test
    void illegalTransition_closeAlreadyClosed_returns409() throws Exception {
        User owner = user("9820200012", "owner");
        Property p = listing(owner, "Double close");

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\"}"))
                .andExpect(status().isOk());

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":6000000,\"counterpartyMobile\":\"9876543211\"}"))
                .andExpect(status().isConflict());
    }

    @ParameterizedTest(name = "{0} listing")
    @ValueSource(strings = {"paused", "pending"})
    void close_nonApprovedListingIsRejectedBecauseOnlyApprovedListingsAreLive(String state) throws Exception {
        User owner = user("paused".equals(state) ? "9820200026" : "9820200027", "owner");
        Property p = listing(owner, state + " close");
        if ("paused".equals(state)) {
            p.pauseByOwner();
        } else {
            p.revertToPending();
        }
        properties.saveAndFlush(p);

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value("conflict"));

        assertThat(dealRepo.findByPropertyId(p.getId())).isEmpty();
        assertThat(properties.findById(p.getId()).orElseThrow().getStatus())
                .isEqualTo("paused".equals(state) ? PropertyStatus.PAUSED : PropertyStatus.PENDING);
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @CsvSource({"919876543210, 200, true", "2012345678, 422, false"})
    void close_counterpartyMobile_acceptedOrRejected(String mobile, int httpStatus, boolean closes) throws Exception {
        User owner = user(closes ? "9820200023" : "9820200025", "owner");
        Property p = listing(owner, "Mobile close " + mobile);

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"" + mobile + "\"}"))
                .andExpect(status().is(httpStatus));

        String dealStatus = dealRepo.findByPropertyId(p.getId())
                .map(Deal::getStatus)
                .orElse(DealStatuses.ACTIVE);
        if (closes) {
            assertThat(dealStatus).isEqualTo(DealStatuses.CLOSED);
        } else {
            assertThat(dealStatus).isNotEqualTo(DealStatuses.CLOSED);
        }
    }

    @Test
    void listParties_returnsLivePartiesOnly() throws Exception {
        User owner = user("9820200015", "owner");
        Property p = listing(owner, "Parties read test");
        mvc.perform(post(dealPath(p) + "/reserve")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk());
        UUID dealId = dealRepo.findByPropertyId(p.getId()).orElseThrow().getId();
        jdbc.update("insert into deal_parties (deal_id, name) values (?, 'Party A')", dealId);
        jdbc.update("insert into deal_parties (deal_id, name, deleted_at) values (?, 'Gone', now())",
                dealId);

        mvc.perform(get(dealPath(p) + "/parties")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].name").value("Party A"));
    }

    @Test
    void closedDeal_blocksNewOffers_a1Regression() throws Exception {
        User owner = user("9820200020", "owner");
        User buyer = user("9820200021", "buyer");
        Property p = listing(owner, "Offer-block regression");

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543299\"}"))
                .andExpect(status().isOk());

        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":5000000}"))
                .andExpect(status().isConflict());
    }

    @Test
    void reopen_clearsCloseTimeFields() throws Exception {
        User owner = user("9820200022", "owner");
        Property p = listing(owner, "Reopen clear test");
        jdbc.update("insert into property_reviews (property_id, status, decided_at, last_message_at)"
                + " values (?, 'approved', now(), now())", p.getId());

        mvc.perform(post(dealPath(p) + "/close")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"agreedPrice\":5000000,\"counterpartyMobile\":\"9876543210\",\"note\":\"Done\"}"))
                .andExpect(status().isOk());

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
        Property reopened = properties.findById(p.getId()).orElseThrow();
        assertThat(reopened.getStatus()).isEqualTo(PropertyStatus.PENDING);
        assertThat(reopened.getResubmittedAt()).isNotNull();
        PropertyReview review = reviews.findByPropertyId(p.getId()).orElseThrow();
        assertThat(review.getStatus()).isEqualTo("pending");
        assertThat(review.getDecidedAt()).isNull();
    }
}
