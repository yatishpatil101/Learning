package com.draazy.api.admin;

import com.draazy.api.support.AbstractApiTest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * A settings key no server code reads is an access-control document an operator is invited to fill
 * in and a later commit could start honouring. Refusal and non-persistence are asserted together.
 */
@DisplayName("D67/D13 — the dead customRoles key is refused, not stored")
class AdminSettingsDeadKeyTest extends AbstractApiTest {

    private static final String CUSTOM_ROLES =
            "[{\"id\":\"CR_evil\",\"name\":\"Ops\",\"modules\":[\"settings\",\"team\"]}]";

    @Autowired
    UserRepository users;

    private String admin(String mobile) {
        User u = new User(mobile, Roles.Wire.ADMIN);
        u.setName("Dead key " + mobile.substring(6));
        u.setMobileVerified(true);
        return bearer(users.saveAndFlush(u));
    }

    /** The status of a {@code PUT /admin/settings} carrying {@code body}. */
    private int save(String token, String body) throws Exception {
        return mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse().getStatus();
    }

    private Integer storedCustomRoleRows() {
        return jdbc.queryForObject(
                "select count(*) from settings where key = 'customRoles'", Integer.class);
    }

    private Integer auditRows() {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = 'settings.update'", Integer.class);
    }

    /** Asserted rather than assumed: a migration that deletes a row is easy to review and never run. */
    @Test
    @DisplayName("no customRoles document is stored")
    void theKeyIsNotStoredAtAll() {
        assertThat(storedCustomRoleRows()).isZero();
    }

    @Test
    @DisplayName("writing it is refused with 422")
    void writingItIsRefused() throws Exception {
        assertThat(save(admin("9877720001"), "{\"customRoles\":" + CUSTOM_ROLES + "}"))
                .isEqualTo(422);
    }

    /** A real key beside the dead one is the shape an admin form sends; storing half is worse. */
    @Test
    @DisplayName("a refused write stores nothing at all, not even its valid keys")
    void aRefusedWriteIsAtomic() throws Exception {
        String token = admin("9877720002");

        assertThat(save(token, "{\"flags\":{\"deadKeyProbe\":true},\"customRoles\":" + CUSTOM_ROLES + "}"))
                .isEqualTo(422);

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.deadKeyProbe").doesNotExist())
                .andExpect(jsonPath("$.customRoles").doesNotExist());
        assertThat(storedCustomRoleRows()).isZero();
    }

    /** The body a console sends after deleting the last custom role — the moment a 200 is believed. */
    @Test
    @DisplayName("an empty list is refused as firmly as a populated one")
    void anEmptyListIsRefusedToo() throws Exception {
        assertThat(save(admin("9877720003"), "{\"customRoles\":[]}")).isEqualTo(422);
    }

    /** A delta, because {@code AuditService.record} is {@code REQUIRES_NEW} and escapes the rollback. */
    @Test
    @DisplayName("a refused write records no audit row")
    void aRefusedWriteRecordsNoAuditRow() throws Exception {
        int before = auditRows();

        assertThat(save(admin("9877720004"), "{\"customRoles\":" + CUSTOM_ROLES + "}"))
                .isEqualTo(422);

        assertThat(auditRows()).isEqualTo(before);
    }

    /** Counterweight: everything above also passes if the endpoint stopped accepting writes at all. */
    @Test
    @DisplayName("an ordinary write is untouched by the refusal")
    void anOrdinaryWriteStillSucceeds() throws Exception {
        String token = admin("9877720005");

        assertThat(save(token, "{\"flags\":{\"deadKeyControl\":true}}")).isEqualTo(200);

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.deadKeyControl").value(true))
                .andExpect(jsonPath("$.fees").exists());
    }

    /** The route stays admin-only, so a non-admin is stopped before the key is even considered. */
    @Test
    @DisplayName("staff are still refused before the key is even considered")
    void staffAreRefusedByTheRoleGuardFirst() throws Exception {
        User staff = new User("9877720006", Roles.Wire.STAFF);
        staff.setName("Dead key staff");
        staff.setMobileVerified(true);
        String token = bearer(users.saveAndFlush(staff));

        assertThat(save(token, "{\"customRoles\":" + CUSTOM_ROLES + "}")).isEqualTo(403);
    }

    // The second dead key: geo.cities.*.live, retired to PATCH /admin/cities/{slug}

    /**
     * City launch state decides what a logged-out visitor sees, so it cannot have an admin-only
     * reader. The key here is read by nothing, which puts it in the customRoles category.
     */
    @Test
    @DisplayName("geo.cities.*.live is refused, and points at the route that replaced it")
    void theRetiredCityLiveKeyIsRefused() throws Exception {
        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, admin("9877720007"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"geo\":{\"cities\":{\"Mumbai\":{\"live\":true}}}}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("/admin/cities/{slug}")));
    }

    /** Counterweight: a nested check that over-reached would take the Maps panel down with it. */
    @Test
    @DisplayName("the rest of the geo block still saves normally")
    void geoBoundsAndBlacklistStillSave() throws Exception {
        String token = admin("9877720008");

        assertThat(save(token, """
                {"geo":{"enforceCityLimit":true,"cities":{"Mumbai":{"center":{"lat":19.076,\
                "lng":72.8777}}},"blacklist":[{"id":"bl1","term":"Camp"}]}}"""))
                .isEqualTo(200);

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.geo.cities.Mumbai.center.lat").value(19.076))
                .andExpect(jsonPath("$.geo.blacklist[0].term").value("Camp"));
    }

    // The third shape: a flag of the wrong TYPE, which is stored and then read as ON

    /**
     * Every reader treats a non-boolean flag as undecided and falls back to absent-means-ON, so a
     * stored {@code "false"} closes signups in the console and leaves them open on the server.
     */
    @Test
    @DisplayName("a flag sent as a string is refused, not stored as a truthy value")
    void aStringFlagIsRefused() throws Exception {
        String token = admin("9877720009");

        mvc.perform(put(Routes.Admin.SETTINGS)
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flags\":{\"signupsEnabled\":\"false\"}}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("flags.signupsEnabled")));

        // Asked of the stored jsonb because "absent" and "the string false" both read as no-value
        // over a JSON path; jsonb_typeof separates them.
        assertThat(jdbc.queryForObject(
                "select jsonb_typeof(value->'signupsEnabled') from settings where key = 'flags'",
                String.class))
                .as("a refused flag must not be stored at all, least of all as a truthy string")
                .isNotEqualTo("string");
    }

    /** Counterweight: {@code false} is the value a too-eager truthiness check would swallow. */
    @Test
    @DisplayName("a genuine boolean flag still saves, false included")
    void aBooleanFlagStillSaves() throws Exception {
        String token = admin("9877720010");

        assertThat(save(token, "{\"flags\":{\"signupsEnabled\":false}}")).isEqualTo(200);

        mvc.perform(get(Routes.Admin.SETTINGS).header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.flags.signupsEnabled").value(false));
    }
}
