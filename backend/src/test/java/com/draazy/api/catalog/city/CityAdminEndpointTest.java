package com.draazy.api.catalog.city;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
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

/**
 * Contract + behaviour proof for the two back-office city surfaces: `PATCH /admin/cities/{slug}`
 * and `GET /admin/cities/waitlist`.
 *
 * <p>They are tested together because they are one decision — the waitlist is the evidence, the
 * toggle is the act — and because their guards deliberately differ, which is only visible when both
 * are asserted in the same place.
 */
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

    // ---------------- GET /admin/cities/waitlist ----------------

    /** Put a signup on the list without going through the public endpoint's validation. */
    private void waitlisted(String mobile, String city, String createdAt) {
        jdbc.update("insert into city_waitlist (mobile, city, created_at) values (?, ?, ?::timestamptz)",
                mobile, city, createdAt);
    }

    @AfterEach
    void clearWaitlist() {
        jdbc.update("delete from city_waitlist where mobile like '98777320%'");
    }

    /**
     * The whole report in one assertion: grouped, counted, dated and ranked.
     *
     * <p>Nashik is asked for twice and Nagpur once, and Nashik is asked for <em>first</em>, so a
     * report that ordered by recency rather than by count would put Nagpur on top. That is the
     * inversion worth testing: the two orderings agree on almost any data you would write by
     * accident.
     */
    @Test
    void theWaitlistIsAggregatedByCityMostWantedFirst() throws Exception {
        waitlisted("9877732001", "Nashik", "2024-01-01T10:00:00Z");
        waitlisted("9877732002", "Nashik", "2024-01-02T10:00:00Z");
        waitlisted("9877732003", "Nagpur", "2024-03-01T10:00:00Z");

        mvc.perform(get(Routes.Admin.CITY_WAITLIST)
                        .header(HttpHeaders.AUTHORIZATION, token("9877731010", Roles.Wire.ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.city=='Nashik')].requests", contains(2)))
                .andExpect(jsonPath("$[?(@.city=='Nagpur')].requests", contains(1)))
                .andExpect(jsonPath("$[?(@.city=='Nashik')].lastRequestedAt",
                        contains("2024-01-02T10:00:00Z")))
                .andExpect(jsonPath("$[0].city").value("Nashik"));
    }

    /**
     * Case is not identity, here or in the unique index.
     *
     * <p>Without the {@code lower(city)} grouping key this reports Indore twice, each half ranked
     * below a city fewer people want — the report would answer the operator's question wrongly
     * while looking entirely healthy.
     */
    @Test
    void citiesDifferingOnlyByCaseAreOneRow() throws Exception {
        waitlisted("9877732004", "Indore", "2024-01-01T10:00:00Z");
        waitlisted("9877732005", "indore", "2024-01-02T10:00:00Z");

        mvc.perform(get(Routes.Admin.CITY_WAITLIST)
                        .header(HttpHeaders.AUTHORIZATION, token("9877731011", Roles.Wire.ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.city =~ /(?i)indore/)].requests", contains(2)));
    }

    /**
     * Counts, and nothing that could identify anybody.
     *
     * <p>The load-bearing assertion of this whole endpoint. {@code city_waitlist} is unverified
     * public submissions carrying a mobile and an optional email, and the reason a finder was
     * allowed onto {@code CityWaitlistRepository} at all is that it groups before it returns. If
     * somebody later adds the contact columns "so ops can follow up", this is what says no.
     */
    @Test
    void theReportCarriesNoContactDetail() throws Exception {
        waitlisted("9877732006", "Surat", "2024-01-01T10:00:00Z");

        String body = mvc.perform(get(Routes.Admin.CITY_WAITLIST)
                        .header(HttpHeaders.AUTHORIZATION, token("9877731012", Roles.Wire.ADMIN)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("Surat").doesNotContain("9877732006").doesNotContain("mobile");
    }

    /** Ops reads this next to the supply gap on the same tab, so staff is enough — but not a buyer. */
    @Test
    void theWaitlistIsStaffReadableAndNotPublic() throws Exception {
        mvc.perform(get(Routes.Admin.CITY_WAITLIST)).andExpect(status().isUnauthorized());

        mvc.perform(get(Routes.Admin.CITY_WAITLIST)
                        .header(HttpHeaders.AUTHORIZATION, token("9877731013", Roles.Wire.BUYER)))
                .andExpect(status().isForbidden());

        mvc.perform(get(Routes.Admin.CITY_WAITLIST)
                        .header(HttpHeaders.AUTHORIZATION, token("9877731014", Roles.Wire.STAFF)))
                .andExpect(status().isOk());
    }
}


