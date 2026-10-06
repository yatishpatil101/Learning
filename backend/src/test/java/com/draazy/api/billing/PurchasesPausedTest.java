package com.draazy.api.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.billing.plan.SubscriptionRepository;
import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("The subscriptionPlans kill switch refuses new purchases at the server")
class PurchasesPausedTest extends AbstractApiTest {

    /** Seeded by {@code R__DML_seed_reference_data.sql}; free, so with the switch on it activates without a gateway. */
    private static final String FREE_PLAN = "b1000000-0000-4000-8000-000000000001";

    @Autowired UserRepository users;
    @Autowired SubscriptionRepository subscriptions;
    @Autowired EntityManager em;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Paused Buyer " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private void setFlag(String name, boolean value) {
        int flipped = jdbc.update("update settings set value = "
                + "jsonb_set(value, ?::text[], ?::jsonb) where key = 'flags'",
                "{" + name + "}", String.valueOf(value));
        assertThat(flipped).isEqualTo(1);
        em.flush();
        em.clear();
    }

    private ResultActions subscribe(User u) throws Exception {
        return mvc.perform(post(Routes.Plans.SUBSCRIPTION)
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"planId\":\"" + FREE_PLAN + "\"}"));
    }

    @Test
    void anOffSwitchRefusesThePurchaseAndOpensNoSubscription() throws Exception {
        User u = owner("9855509001");
        setFlag("subscriptionPlans", false);

        subscribe(u)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value(ErrorCodes.PURCHASES_PAUSED));
        assertThat(subscriptions.findAll()).noneMatch(s -> s.getUserId().equals(u.getId()));
    }

    /** Counterweight: without it, a gate that refused everyone would pass the test above. */
    @Test
    void switchingItBackOnSellsAgain() throws Exception {
        User u = owner("9855509002");
        setFlag("subscriptionPlans", false);
        setFlag("subscriptionPlans", true);

        subscribe(u).andExpect(status().isCreated());
    }
}
