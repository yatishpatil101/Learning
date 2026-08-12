package com.punenest.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.security.Teams;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The management half of D192/D13 — the endpoint {@code V61} recorded as not existing at all
 * ("no team-member management endpoint of any kind — the Team &amp; Access console writes to browser
 * storage").
 *
 * <p>Most of what is asserted here is <strong>refusals</strong>, and that is the point of the
 * surface. A write endpoint that stored whatever it was sent would recreate the exact artefact this
 * lane exists to clean up: an access-control document full of names an operator was told meant
 * something and the server ignores.
 *
 * <p>Audit rows are written {@code REQUIRES_NEW} and therefore survive the rollback, so the
 * successful writes below clean {@code audit_log} themselves.
 */
@DisplayName("D192/D13 — the per-account permission endpoints")
class BackOfficeAccessEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private User save(String mobile, String role, String team) {
        User user = new User(mobile, role);
        user.setName("Access endpoint probe");
        user.setTeam(team);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private int putPermissions(User actor, User target, String body) throws Exception {
        return mvc.perform(put(Routes.Users.PERMISSIONS.replace("{id}", target.getId().toString()))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer "
                                + jwtService.issueAccessToken(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse().getStatus();
    }

    @AfterEach
    void clearCommittedAuditRows() {
        jdbc.update("DELETE FROM audit_log WHERE action = 'user.permissions.replace'");
    }

    @Test
    @DisplayName("the catalogue is served, and every entry is module:action")
    void catalogueIsServed() throws Exception {
        User admin = save("9866030001", Roles.Wire.ADMIN, null);

        mvc.perform(get(Routes.Admin.PERMISSION_CATALOGUE)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer "
                                + jwtService.issueAccessToken(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.name == 'tickets:read')].action").value("read"))
                .andExpect(jsonPath("$[?(@.name == 'settings:write')].adminOnly").value(true));
    }

    /**
     * Staff are refused the whole surface. Editing who may do what is the same privilege as minting
     * a colleague, and the role guard is the first term of both.
     */
    @Test
    @DisplayName("staff cannot read the catalogue or write a document")
    void staffAreRefused() throws Exception {
        User staff = save("9866030002", Roles.Wire.STAFF, Teams.RENTAL);
        User target = save("9866030003", Roles.Wire.STAFF, Teams.LEGAL);

        mvc.perform(get(Routes.Admin.PERMISSION_CATALOGUE)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer "
                                + jwtService.issueAccessToken(staff)))
                .andExpect(status().isForbidden());
        assertThat(putPermissions(staff, target, "{\"permissions\":[\"tickets:read\"]}"))
                .isEqualTo(403);
    }

    /** The end-to-end claim: an administrator's write actually removes access. */
    @Test
    @DisplayName("a written document narrows the account it names")
    void aWrittenDocumentNarrows() throws Exception {
        User admin = save("9866030004", Roles.Wire.ADMIN, null);
        User target = save("9866030005", Roles.Wire.STAFF, Teams.RENTAL);

        assertThat(putPermissions(admin, target, "{\"permissions\":[\"tickets:read\"]}"))
                .isEqualTo(200);

        String bearer = "Bearer " + jwtService.issueAccessToken(target);
        assertThat(mvc.perform(get(Routes.Tickets.BASE).header(HttpHeaders.AUTHORIZATION, bearer))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(mvc.perform(get(Routes.Admin.DASHBOARD).header(HttpHeaders.AUTHORIZATION, bearer))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
    }

    /** The response shows the outcome, not the input — see {@link BackOfficeAccessResponse}. */
    @Test
    @DisplayName("the read reports stored, effective and whether a document exists at all")
    void theReadReportsStoredAndEffective() throws Exception {
        User admin = save("9866030006", Roles.Wire.ADMIN, null);
        User target = save("9866030007", Roles.Wire.STAFF, Teams.RENTAL);
        String actor = "Bearer " + jwtService.issueAccessToken(admin);
        String route = Routes.Users.PERMISSIONS.replace("{id}", target.getId().toString());

        mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, actor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scoped").value(false))
                .andExpect(jsonPath("$.permissions").isEmpty())
                .andExpect(jsonPath("$.effective").value(hasItem("tickets:read")));

        assertThat(putPermissions(admin, target, "{\"permissions\":[]}")).isEqualTo(200);

        mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, actor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scoped").value(true))
                .andExpect(jsonPath("$.effective").isEmpty());
    }

    /**
     * The console's own vocabulary is refused rather than stored. This is the endpoint half of
     * {@code V61}'s "inventing that mapping is writing policy nobody agreed" — the server does not
     * translate {@code properties:verify}, and it does not pretend to.
     */
    @Test
    @DisplayName("a name the server does not enforce is refused, not stored")
    void unknownNamesAreRefused() throws Exception {
        User admin = save("9866030008", Roles.Wire.ADMIN, null);
        User target = save("9866030009", Roles.Wire.STAFF, Teams.RENTAL);

        assertThat(putPermissions(admin, target, "{\"permissions\":[\"properties:verify\"]}"))
                .isEqualTo(422);
        assertThat(putPermissions(admin, target, "{\"permissions\":[\"enquiries\"]}"))
                .isEqualTo(422);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM back_office_permissions WHERE user_id = ?::uuid",
                Integer.class, target.getId().toString())).isZero();
    }

    /** A name the target's role can never hold reads like a grant, so it is refused as one. */
    @Test
    @DisplayName("an admin-only permission cannot be written onto a staff account")
    void aboveTheCeilingIsRefused() throws Exception {
        User admin = save("9866030010", Roles.Wire.ADMIN, null);
        User target = save("9866030011", Roles.Wire.STAFF, Teams.RENTAL);

        assertThat(putPermissions(admin, target,
                "{\"permissions\":[\"tickets:read\",\"settings:write\"]}")).isEqualTo(422);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM back_office_permissions WHERE user_id = ?::uuid",
                Integer.class, target.getId().toString())).isZero();
    }

    /** A buyer has no baseline to narrow, so a document for one could only read as a grant. */
    @Test
    @DisplayName("a non back-office account cannot be given a permission document")
    void nonOpsTargetsAreRefused() throws Exception {
        User admin = save("9866030012", Roles.Wire.ADMIN, null);
        User buyer = save("9866030013", Roles.Wire.BUYER, null);

        assertThat(putPermissions(admin, buyer, "{\"permissions\":[]}")).isEqualTo(422);
    }

    /**
     * Self-edit is refused so that an administrator cannot remove their own ability to undo the
     * removal. Two administrators can still scope each other, which is the shape this surface should
     * have had anyway.
     */
    @Test
    @DisplayName("an administrator cannot edit their own permissions")
    void selfEditIsRefused() throws Exception {
        User admin = save("9866030014", Roles.Wire.ADMIN, null);

        assertThat(putPermissions(admin, admin, "{\"permissions\":[]}")).isEqualTo(403);
    }

    @Test
    @DisplayName("an unknown account is a 404, not a silently created document")
    void unknownTargetIsNotFound() throws Exception {
        User admin = save("9866030015", Roles.Wire.ADMIN, null);

        mvc.perform(put(Routes.Users.PERMISSIONS
                        .replace("{id}", "11111111-1111-1111-1111-111111111111"))
                        .header(HttpHeaders.AUTHORIZATION, "Bearer "
                                + jwtService.issueAccessToken(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"permissions\":[]}"))
                .andExpect(status().isNotFound());
    }
}
