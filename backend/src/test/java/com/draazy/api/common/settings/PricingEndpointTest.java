package com.draazy.api.common.settings;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * Contract + behaviour proof for {@code GET /pricing}.
 *
 * <p><strong>What this replaces.</strong> Every price the product quotes lived in {@code
 * FEE_DEFAULTS}, a constant in the browser bundle, with a local-storage copy layered over it. The
 * back office could edit the platform's prices, the write was real, and no visitor ever saw the
 * result: changing a price took a deployment, and the number a caller was quoted depended on which
 * machine they were sitting at. The assertions here are aimed at exactly that: that the route
 * answers without a token, that it carries every price the client needs so none has to be kept in
 * the bundle as a fallback, and that a figure an admin writes is the figure an anonymous visitor
 * subsequently reads.
 *
 * <p>The last two tests are about the thing a public projection of a settings block gets wrong. The
 * same document holds the free contact allowance, the referral bonus and the referral auto-qualify
 * threshold — and that last one is the line past which a referral goes to the fraud desk, which is
 * the one number on the platform that must not be published. They are written as absences, because
 * the mistake they catch is somebody widening this into "the public settings endpoint".
 */
class PricingEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /** Mobile block 98691000xx — used by no other test class. */
    private String adminToken() {
        User u = new User("9869100001", Roles.Wire.ADMIN);
        u.setName("Pricing Admin");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /**
     * Reachable with no Authorization header.
     *
     * <p>The route-constant/security-matcher agreement check. A route mapped in the controller but
     * missed in {@code SecurityConfig} would 401 here, and the symptom in the browser would be a
     * plans page that silently fell back to its bundled constants — indistinguishable from the
     * endpoint working, right up until somebody changed a price.
     */
    @Test
    void anonymousCallersGetThePriceList() throws Exception {
        mvc.perform(get(Routes.Pricing.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerProYearly").value(2499))
                .andExpect(jsonPath("$.gstPercent").value(18));
    }

    /**
     * All seven keys are present.
     *
     * <p>Every one of them, because a client that has to fall back to a bundled default for even a
     * single price is a client that still has a price in its bundle — which is the defect this
     * route exists to remove, merely six-sevenths smaller.
     *
     * <p>Asserted key by key with {@code exists()} rather than by counting or by value, because the
     * defaults in {@link PlatformSettings} deliberately equal the seed row: a route that never
     * managed to read the row at all would answer with exactly the right numbers anyway, so no
     * assertion about a value can tell the two apart. {@code exists()} catches the key going
     * missing from the response shape; {@link #aPriceAnAdminChangesIsThePriceAnAnonymousVisitorIsQuoted()}
     * below is what proves the row is genuinely being read, by changing it and watching the answer
     * move.
     */
    @Test
    void everyPriceTheClientNeedsIsPublished() throws Exception {
        mvc.perform(get(Routes.Pricing.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerPlanYearly").exists())
                .andExpect(jsonPath("$.ownerProYearly").exists())
                .andExpect(jsonPath("$.rentAgreementPlatform").exists())
                .andExpect(jsonPath("$.seekerPlusTopup").exists())
                .andExpect(jsonPath("$.featuredListing").exists())
                .andExpect(jsonPath("$.gstPercent").exists());
    }

    /**
     * A repricing done in the back office is what a visitor with no account is quoted.
     *
     * <p>The reason the route was built, asserted end to end. It is also the only test here that
     * can tell a real read from a controller that returns the same seven numbers as literals: the
     * seeded values and the hard-coded ones would agree on every other assertion in this class.
     *
     * <p>The untouched sibling in the same block is checked in the same breath, because the
     * settings write is a deep merge (S60) — under replace semantics a panel that repriced one plan
     * would silently delete the six figures it was not currently showing.
     */
    @Test
    void aPriceAnAdminChangesIsThePriceAnAnonymousVisitorIsQuoted() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fees\":{\"ownerProYearly\":5499,\"seekerPlusTopup\":349}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Pricing.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerProYearly").value(5499))
                .andExpect(jsonPath("$.seekerPlusTopup").value(349))
                .andExpect(jsonPath("$.featuredListing").value(999));
    }

    /**
     * The fraud threshold and the contact allowances share a settings block with the prices and do
     * not leave the building.
     *
     * <p>{@code referralQualifyPerMonth} is how many referrals one account may have qualify
     * automatically in a month before the rest go to a human. Publishing it tells the one reader
     * who most wants to know precisely where to stop, and it would be published by any response
     * shaped as "the fees block" rather than as seven named prices.
     */
    @Test
    void theRestOfTheFeesBlockIsNotPublished() throws Exception {
        mvc.perform(get(Routes.Pricing.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.referralQualifyPerMonth").doesNotExist())
                .andExpect(jsonPath("$.referralContactBonus").doesNotExist())
                .andExpect(jsonPath("$.freeContactLimit").doesNotExist());
    }

    /**
     * None of the neighbouring settings blocks appear either.
     *
     * <p>The same guard {@code /move-pack} and {@code /flags} carry, for the same reason: the fee
     * table, the permission map and the back-office toggles live in the same document, the whole
     * argument for a public route is that this one projection is not sensitive while its neighbours
     * are, and the way that argument gets lost is one convenient widening at a time.
     */
    @Test
    void noOtherSettingsBlockLeaks() throws Exception {
        mvc.perform(get(Routes.Pricing.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.adminFlags").doesNotExist())
                .andExpect(jsonPath("$.geo").doesNotExist())
                .andExpect(jsonPath("$.movePack").doesNotExist())
                .andExpect(jsonPath("$.site").doesNotExist());
    }
}
