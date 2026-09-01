package com.punenest.api.catalog.city;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Contract + behaviour proof for `PATCH /admin/cities/{slug}`. */
class CityAdminEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private String adminId;

    @AfterEach
    void restoreBaseline() {
        if (adminId != null) {
            jdbc.update("delete from audit_log where actor = ?", adminId);
        }
        // These tests launch cities, and the roster is shared state that the repeatable seed no
        // longer reasserts (`live` is set on INSERT only, so that a re-seed cannot un-launch what
        // ops launched). Put it back by hand, or the next class to read `GET /cities` inherits a
        // live Mumbai from whichever test happened to run first.
        jdbc.update("update cities set live = (slug = 'pune')");
    }

    private String token(String mobile, String role) {
        User user = new User(mobile, role);
        user.setName(role + " city editor");
        user.setMobileVerified(true);
        User saved = users.saveAndFlush(user);
        if (Roles.Wire.ADMIN.equals(role)) {
            adminId = saved.getId().toString();
        }
        return bearer(saved);
    }

    @Test
    void adminCanToggleACityAndThePublicCatalogueReflectsIt() throws Exception {
        mvc.perform(patch(Routes.Admin.CITY_BY_SLUG.replace("{slug}", "mumbai"))
                        .header(HttpHeaders.AUTHORIZATION, token("9877731001", Roles.Wire.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"live":true}"""))
                .andExpect(status().isNoContent());

        mvc.perform(get(Routes.Cities.BASE))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.slug=='mumbai')].live", contains(true)));
    }

    /**
     * Launching a city is an operational decision, and a decision nobody can attribute is not much
     * of a record. The {@code @AfterEach} above already knows a row is written; without this, that
     * is the only thing in the suite that does.
     */
    @Test
    void togglingACityIsAudited() throws Exception {
        mvc.perform(patch(Routes.Admin.CITY_BY_SLUG.replace("{slug}", "hyderabad"))
                        .header(HttpHeaders.AUTHORIZATION, token("9877731005", Roles.Wire.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"live":true}"""))
                .andExpect(status().isNoContent());

        Map<String, Object> row = jdbc.queryForMap(
                "select action, entity, entity_id, metadata::text as metadata "
                        + "from audit_log where actor = ?", adminId);

        assertThat(row.get("action")).isEqualTo("city.update");
        assertThat(row.get("entity")).isEqualTo("city");
        assertThat(row.get("entity_id")).isEqualTo("hyderabad");
        assertThat(String.valueOf(row.get("metadata")))
                .contains("\"beforeLive\": false")
                .contains("\"afterLive\": true");
    }

    @Test
    void routeIsAdminOnly() throws Exception {
        mvc.perform(patch(Routes.Admin.CITY_BY_SLUG.replace("{slug}", "mumbai"))
                        .header(HttpHeaders.AUTHORIZATION, token("9877731002", Roles.Wire.OWNER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"live":true}"""))
                .andExpect(status().isForbidden());
    }

    /**
     * The role is only half the guard. Without this, deleting {@code settings:write} from the
     * {@code @PreAuthorize} would leave every other test in this class green — an unenforced
     * permission that looks enforced is the D192/D13 failure the atom exists to prevent.
     */
    @Test
    void anAdministratorNarrowedOffSettingsWriteIsRefused() throws Exception {
        User scoped = new User("9877731006", Roles.Wire.ADMIN);
        scoped.setName("narrowed admin");
        scoped.setMobileVerified(true);
        User saved = users.saveAndFlush(scoped);
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) "
                + "VALUES (?::uuid, ?::jsonb)", saved.getId().toString(), "[\"settings:read\"]");

        mvc.perform(patch(Routes.Admin.CITY_BY_SLUG.replace("{slug}", "mumbai"))
                        .header(HttpHeaders.AUTHORIZATION, bearer(saved))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"live":true}"""))
                .andExpect(status().isForbidden());
    }

    @Test
    void missingLiveIsAValidationError() throws Exception {
        mvc.perform(patch(Routes.Admin.CITY_BY_SLUG.replace("{slug}", "mumbai"))
                        .header(HttpHeaders.AUTHORIZATION, token("9877731003", Roles.Wire.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnprocessableContent());
    }

    @Test
    void unknownCityIsNotFound() throws Exception {
        mvc.perform(patch(Routes.Admin.CITY_BY_SLUG.replace("{slug}", "nagpur"))
                        .header(HttpHeaders.AUTHORIZATION, token("9877731004", Roles.Wire.ADMIN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"live":true}"""))
                .andExpect(status().isNotFound());
    }
}


