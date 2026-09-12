package com.draazy.api.common.settings;

import com.draazy.api.support.AbstractApiTest;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The flag block gates what a logged-out visitor sees while its document is admin-only, so the two
 * load-bearing claims are: anonymous callers get the flags, and get only the flags.
 */
class AppFlagsEndpointTest extends AbstractApiTest {

    @Autowired UserRepository users;

    @PersistenceContext EntityManager em;

    private String adminToken() {
        User u = new User("9877720001", Roles.Wire.ADMIN);
        u.setName("Flags Admin");
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /**
     * A route missed in {@code SecurityConfig} 401s here. Invisible from the client — the site keeps
     * working while every flag falls back to its default.
     */
    @Test
    void anonymousCallersGetTheSeededFlags() throws Exception {
        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.kycBadgeEnabled").value(true))
                .andExpect(jsonPath("$.boostEnabled").value(true))
                .andExpect(jsonPath("$.maintenanceMode").value(false));
    }

    /**
     * Written as absences: the fee table, permission map and branding share the document, and
     * widening this to "the public settings endpoint" is the mistake this test is positioned to catch.
     */
    @Test
    void nothingButTheFlagBlockIsPublished() throws Exception {
        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fees").doesNotExist())
                .andExpect(jsonPath("$.permissions").doesNotExist())
                .andExpect(jsonPath("$.adminFlags").doesNotExist())
                .andExpect(jsonPath("$.site").doesNotExist())
                .andExpect(jsonPath("$.geo").doesNotExist());
    }

    /** The reason the route exists: a client reading its own cached copy serves the site anyway. */
    @Test
    void aFlagSavedByAnAdminIsVisibleToAnAnonymousClient() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, adminToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"maintenanceMode\":true,\"mapSearch\":false}}"))
                .andExpect(status().isOk());

        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.maintenanceMode").value(true))
                .andExpect(jsonPath("$.mapSearch").value(false))
                // The merge is deep: a regression would blank untouched features in the response
                // the client renders from, without failing any admin-side assertion.
                .andExpect(jsonPath("$.kycBadgeEnabled").value(true));
    }

    /**
     * A string {@code "false"} reads as enabled on the client, so forwarding it buys no behaviour.
     * Seeded with raw SQL because the 422 gate means it cannot arrive through the API.
     */
    @Test
    void nonBooleanValuesAreOmitted() throws Exception {
        jdbc.update("update settings set value = jsonb_set(value, '{emiCalculator}', '\"false\"') "
                + "where key = 'flags'");
        // The whole test runs in one transaction, so a settings row already loaded through JPA
        // would hide the UPDATE underneath it from the endpoint's own read.
        em.flush();
        em.clear();

        mvc.perform(get(Routes.Flags.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.emiCalculator").doesNotExist())
                // Counterweight: a projection that dropped everything would not pass.
                .andExpect(jsonPath("$.maintenanceMode").value(false));
    }
}
