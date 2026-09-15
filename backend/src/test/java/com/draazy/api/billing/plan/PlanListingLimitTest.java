package com.draazy.api.billing.plan;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpHeaders;

/**
 * A null {@code plans.listing_limit} resolves to the free floor of one, not to unlimited. Both halves
 * are pinned: the resolution, and the CHECK that stops an owner plan being minted without a number.
 */
@DisplayName("Plans — a null listing limit is the free floor, not a licence")
class PlanListingLimitTest extends AbstractApiTest {

    /** Seeker Plus. A tenant plan, and the only seeded row with a null {@code listing_limit}. */
    private static final String NO_LISTING_NUMBER_PLAN = "b1000000-0000-4000-8000-000000000004";

    @Autowired UserRepository users;
    @Autowired TestPlanGrants grants;

    private User owner(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Limit " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    @Test
    @DisplayName("holding a plan that states no listing number grants one listing, not unlimited")
    void aNullLimitResolvesToTheFreeFloor() throws Exception {
        // Read first: the assertion below is vacuous if somebody gives Seeker Plus a number.
        assertThat(jdbc.queryForObject("SELECT listing_limit FROM plans WHERE id = ?::uuid",
                Integer.class, NO_LISTING_NUMBER_PLAN)).isNull();

        User u = owner("9844600001");
        grants.grant(u.getId(), UUID.fromString(NO_LISTING_NUMBER_PLAN));

        mvc.perform(get(Routes.Plans.ENTITLEMENTS).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.listings.allowance").value(1));
    }

    @Test
    @DisplayName("an owner plan may not leave the listing limit unstated")
    void ownerPlansMustStateTheNumber() {
        // Counterweight runs first: a failed statement aborts the transaction, so a guard nobody
        // can satisfy would forbid every owner plan.
        jdbc.update("INSERT INTO plans (name, audience, listing_limit) VALUES (?, 'owner', 9999)",
                "Owner Effectively Uncapped");

        assertThatThrownBy(() -> jdbc.update(
                        "INSERT INTO plans (name, audience) VALUES (?, 'owner')", "Owner Unstated"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("plans_owner_states_listing_limit");
    }
}
