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

/** Round trips are admin write then anonymous read; other fee-block keys (fraud threshold) are never published. */
class PricingEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /** Mobile block 98691000xx — used by no other test class. */
    private String adminToken() {
        User u = new User("9869100001", Roles.Wire.ADMIN);
        u.setName("Pricing Admin");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /** Anonymous: a route missed in {@code SecurityConfig} would 401 and plans would use bundled constants. */
    @Test
    void anonymousCallersGetThePriceList() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pricing.ownerProYearly").value(2499))
                .andExpect(jsonPath("$.pricing.gstPercent").value(18));
    }

    /** Checked per key with {@code exists()}: defaults equal the seed row, so a value check proves no read. */
    @Test
    void everyPriceTheClientNeedsIsPublished() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pricing.ownerPlanYearly").exists())
                .andExpect(jsonPath("$.pricing.ownerProYearly").exists())
                .andExpect(jsonPath("$.pricing.rentAgreementPlatform").exists())
                .andExpect(jsonPath("$.pricing.seekerPlusTopup").exists())
                .andExpect(jsonPath("$.pricing.gstPercent").exists());
    }

    /** Only test that tells a real row read from literals; the untouched sibling proves the write deep-merges. */
    @Test
    void aPriceAnAdminChangesIsThePriceAnAnonymousVisitorIsQuoted() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fees\":{\"ownerProYearly\":5499,\"seekerPlusTopup\":349}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pricing.ownerProYearly").value(5499))
                .andExpect(jsonPath("$.pricing.seekerPlusTopup").value(349))
                .andExpect(jsonPath("$.pricing.rentAgreementPlatform").value(500));
    }

    /** The fraud threshold and contact allowances share the prices block but must never be published. */
    @Test
    void theRestOfTheFeesBlockIsNotPublished() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pricing.referralQualifyPerMonth").doesNotExist())
                .andExpect(jsonPath("$.pricing.referralContactBonus").doesNotExist())
                .andExpect(jsonPath("$.pricing.freeContactLimit").doesNotExist());
    }
}
