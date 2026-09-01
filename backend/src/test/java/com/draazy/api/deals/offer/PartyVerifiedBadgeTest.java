package com.draazy.api.deals.offer;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.finance.tenancy.TenantProfile;
import com.draazy.api.finance.tenancy.TenantProfileRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The Verified Tenant badge on a party payload (tech-debt D114).
 *
 * <p><strong>What was wrong.</strong> The badge was decided in the browser by matching the party's
 * mobile against a list of verified numbers. D5 masks a buyer's mobile on the way out
 * ({@code 98XXXXX210}), and a mask is not reversible, so the match could never succeed against the
 * real API — the badge rendered in mock mode, where the numbers are real, and was permanently
 * absent in live. A mock more permissive than the server it stands in for passes tests the real
 * thing would fail (D97(d)), which is why this test asserts against the server rather than the seam.
 *
 * <p><strong>What is asserted.</strong> That {@code verified} is a real answer and not a constant:
 * the same endpoint, the same shape of buyer, differing only in whether a verified tenant profile
 * exists — and that the flag is right in both directions. The masked mobile is asserted alongside
 * it deliberately: the two facts travelling together on one payload is the whole fix, and a future
 * change that "simplifies" the flag away by going back to the number would fail here.
 */
class PartyVerifiedBadgeTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired TenantProfileRepository tenantProfiles;

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

    /** A tenant profile carrying (or not carrying) the badge — the only fact under test. */
    private void tenantProfile(User u, boolean verified) {
        TenantProfile profile = new TenantProfile(u.getId());
        profile.setVerified(verified);
        tenantProfiles.saveAndFlush(profile);
    }

    private void submitOffer(User buyer, Property p, long amount) throws Exception {
        mvc.perform(post(Routes.Offers.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"propertyId\":\"" + p.getId() + "\",\"amount\":" + amount + "}"))
                .andExpect(status().isCreated());
    }

    @Test
    void offersOnMine_verifiedBuyer_carriesTheBadgeDespiteTheMaskedMobile() throws Exception {
        User owner = user("9861100001", "owner");
        User buyer = user("9861100002", "buyer");
        tenantProfile(buyer, true);
        Property p = listing(owner, "Verified buyer");

        submitOffer(buyer, p, 24000L);

        // The owner is the viewer, so the buyer's number is masked — and the badge still arrives.
        // That pairing is the point: under the old client-side derivation these two assertions
        // could not both hold, because the masked value was the input to the badge.
        mvc.perform(get(Routes.Offers.ME).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].from.mobile").value("98XXXXX002"))
                .andExpect(jsonPath("$.content[0].from.verified").value(true));
    }

    @Test
    void offersOnMine_unverifiedBuyer_carriesNoBadge() throws Exception {
        User owner = user("9861100003", "owner");
        User buyer = user("9861100004", "buyer");
        // A saved profile that was never verified — distinct from having no profile at all, and the
        // case a flag hardcoded to `true` would sail through.
        tenantProfile(buyer, false);
        Property p = listing(owner, "Unverified buyer");

        submitOffer(buyer, p, 23000L);

        mvc.perform(get(Routes.Offers.ME).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].from.verified").value(false));
    }

    @Test
    void offersOnMine_buyerWithNoProfile_carriesNoBadge() throws Exception {
        User owner = user("9861100005", "owner");
        User buyer = user("9861100006", "buyer");
        Property p = listing(owner, "No profile");

        submitOffer(buyer, p, 22000L);

        mvc.perform(get(Routes.Offers.ME).header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].from.verified").value(false));
    }

    @Test
    void finalizationStatus_verifiedInitiator_carriesTheBadgeDespiteTheMaskedMobile() throws Exception {
        User owner = user("9861100007", "owner");
        User buyer = user("9861100008", "buyer");
        tenantProfile(buyer, true);
        Property p = listing(owner, "Finalization verified");

        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + owner.getMobile()
                                + "\",\"agreedPrice\":5000000}"))
                .andExpect(status().isOk());

        // The counterparty's mobile stays masked at every finalization status, so this payload is
        // the one where a number could never have answered the question.
        mvc.perform(get("/finalization/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.initiator.mobile").value("98XXXXX008"))
                .andExpect(jsonPath("$.initiator.verified").value(true))
                // The owner has no tenant profile: the flag is per-party, not per-request.
                .andExpect(jsonPath("$.counterparty.verified").value(false));
    }

    @Test
    void finalizationStatus_unverifiedInitiator_carriesNoBadge() throws Exception {
        User owner = user("9861100009", "owner");
        User buyer = user("9861100010", "buyer");
        tenantProfile(buyer, false);
        Property p = listing(owner, "Finalization unverified");

        mvc.perform(post(Routes.Finalization.REQUEST.replace("{propId}", p.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + owner.getMobile()
                                + "\",\"agreedPrice\":5000000}"))
                .andExpect(status().isOk());

        mvc.perform(get("/finalization/" + p.getId() + "/status")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.initiator.verified").value(false));
    }
}
