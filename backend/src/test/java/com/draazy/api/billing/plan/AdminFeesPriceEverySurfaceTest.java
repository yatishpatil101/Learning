package com.draazy.api.billing.plan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.test.web.servlet.ResultActions;

/** The admin Fees tab is the only price source: the catalogue, the fee schedule and the charge follow it. */
class AdminFeesPriceEverySurfaceTest extends AbstractApiTest {

    private static final String OWNER_FREE = "b1000000-0000-4000-8000-000000000001";
    private static final String OWNER_PLUS = "b1000000-0000-4000-8000-000000000002";
    private static final String OWNER_PRO = "b1000000-0000-4000-8000-000000000003";
    private static final String SEEKER_PLUS = "b1000000-0000-4000-8000-000000000004";

    @Autowired UserRepository users;
    @Autowired SubscriptionRepository subscriptions;

    /** Mobile block 98691200xx — used by no other test class. */
    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Fees User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String adminAuth;

    private ResultActions saveFees(String fees) throws Exception {
        if (adminAuth == null) {
            adminAuth = bearer(user("9869120001", Roles.Wire.ADMIN));
        }
        return mvc.perform(put(Routes.Admin.SETTINGS)
                .header(HttpHeaders.AUTHORIZATION, adminAuth)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"fees\":" + fees + "}"));
    }

    private static String planPrice(String id) {
        return "$.plans[?(@.id=='" + id + "')].price";
    }

    @Test
    void repricedPlansAreWhatTheCatalogueQuotes() throws Exception {
        saveFees("{\"ownerPlanYearly\":1299,\"ownerProYearly\":2999,\"seekerPlusTopup\":249}")
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath(planPrice(OWNER_FREE)).value(hasItem(0)))
                .andExpect(jsonPath(planPrice(OWNER_PLUS)).value(hasItem(1299)))
                .andExpect(jsonPath(planPrice(OWNER_PRO)).value(hasItem(2999)))
                .andExpect(jsonPath(planPrice(SEEKER_PLUS)).value(hasItem(249)))
                .andExpect(jsonPath("$.plans[0].id").value(OWNER_FREE))
                .andExpect(jsonPath("$.plans[3].id").value(OWNER_PRO));
    }

    @Test
    void aRepricedPlanIsWhatTheCustomerIsCharged() throws Exception {
        saveFees("{\"ownerPlanYearly\":1299}").andExpect(status().isOk());
        User owner = user("9869120002", Roles.Wire.OWNER);

        mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planId\":\"" + OWNER_PLUS + "\",\"paymentMethod\":\"upi\"}"))
                .andExpect(status().isCreated());

        assertThat(subscriptions.findByUserIdOrderByStartedAtDesc(owner.getId()))
                .singleElement()
                .extracting(Subscription::getAmount)
                .isEqualTo(1299L);
    }

    @Test
    void theRentAgreementFeeAndItsGstFollowTheAdminFee() throws Exception {
        saveFees("{\"rentAgreementPlatform\":750}").andExpect(status().isOk());

        mvc.perform(get(Routes.Fees.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.deal=='rent')].platformFee").value(hasItem(750)))
                .andExpect(jsonPath("$[?(@.deal=='rent')].gst").value(hasItem(135)));
    }

    @Test
    void theSeededScheduleAgreesEverywhere() throws Exception {
        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(jsonPath(planPrice(OWNER_PLUS)).value(hasItem(999)))
                .andExpect(jsonPath(planPrice(OWNER_PRO)).value(hasItem(2499)))
                .andExpect(jsonPath(planPrice(SEEKER_PLUS)).value(hasItem(199)));
        mvc.perform(get(Routes.Fees.BASE))
                .andExpect(jsonPath("$[?(@.deal=='rent')].platformFee").value(hasItem(500)))
                .andExpect(jsonPath("$[?(@.deal=='rent')].gst").value(hasItem(90)));
    }

    // Stored but unreadable, it would sit in the admin panel while the site charged the default.
    @Test
    void aPriceTheSiteWouldIgnoreIsRefused() throws Exception {
        saveFees("{\"ownerProYearly\":150000}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("fees.ownerProYearly")));
        saveFees("{\"seekerPlusTopup\":-1}").andExpect(status().isUnprocessableEntity());
        saveFees("{\"ownerPlanYearly\":0}").andExpect(status().isUnprocessableEntity());
        saveFees("{\"rentAgreementPlatform\":499.5}").andExpect(status().isUnprocessableEntity());

        mvc.perform(get(Routes.Bootstrap.BASE))
                .andExpect(jsonPath(planPrice(OWNER_PRO)).value(hasItem(2499)));
    }
}
