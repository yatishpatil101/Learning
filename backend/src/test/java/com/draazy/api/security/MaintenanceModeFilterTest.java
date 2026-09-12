package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * A React overlay cannot enforce the flag — the API keeps accepting writes from anything that is not
 * that overlay, which is every caller here. "Allowed" is asserted as not-503 so no fixture is needed.
 */
@DisplayName("Maintenance mode (server-side)")
class MaintenanceModeFilterTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    /** A consumer write during a window is refused, and says why in a code a client can act on. */
    @Test
    void maintenanceRefusesAConsumerWrite() throws Exception {
        setMaintenance(true);

        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("maintenance_mode"));
    }

    /** Counterweight: a filter that answered 503 unconditionally would look correct without this. */
    @Test
    void anOpenPlatformDoesNotRefuseThatSameWrite() throws Exception {
        setMaintenance(false);

        mvc.perform(post(Routes.SocietyLeads.BASE)
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().is(Matchers.not(503)));
    }

    /** Including the read that tells the browser to draw the maintenance page. */
    @Test
    void maintenanceLeavesReadsAlone() throws Exception {
        setMaintenance(true);

        mvc.perform(get(Routes.Flags.BASE)).andExpect(status().isOk());
    }

    /** Refusing these would make switching maintenance on also switch off the way to turn it off. */
    @Test
    void maintenanceLeavesTheCredentialRoutesOpen() throws Exception {
        setMaintenance(true);

        mvc.perform(post(Routes.Auth.LOGIN).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mobile\":\"9876511001\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.otpSent").value(true));
    }

    /**
     * A real signed token, not a mocked security context: the exemption reads the authority
     * {@link JwtAuthFilter} resolved, so hand-installing it would prove only the setup.
     */
    @Test
    void maintenanceExemptsInternalCallers() throws Exception {
        User admin = users.saveAndFlush(new User("9876511002", "admin"));
        setMaintenance(true);

        mvc.perform(post(Routes.SocietyLeads.BASE).header(HttpHeaders.AUTHORIZATION, bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().is(Matchers.not(503)));
    }

    /**
     * {@code clear()} because a JPA-cached settings row would hide the raw UPDATE from the filter.
     * The row count is asserted so an unseeded {@code flags} key cannot make every test above a no-op.
     */
    private void setMaintenance(boolean on) {
        int flipped = jdbc.update("update settings set value = "
                + "jsonb_set(value, '{maintenanceMode}', ?::jsonb) where key = 'flags'",
                String.valueOf(on));
        assertThat(flipped).isEqualTo(1);
        em.flush();
        em.clear();
    }
}
