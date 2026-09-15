package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/** A staff account must name a desk, because the permission map is keyed by one. */
@DisplayName("staff accounts must name a team")
class StaffTeamRequiredTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private User admin(String mobile, String email) {
        User user = new User(mobile, Roles.Wire.ADMIN);
        user.setName("Team probe " + mobile);
        user.setEmail(email);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private org.springframework.test.web.servlet.ResultActions create(User actor, String body)
            throws Exception {
        return mvc.perform(post(Routes.Users.STAFF)
                .header(HttpHeaders.AUTHORIZATION, bearer(actor))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    /** Counterweight: every refusal below is vacuous if the endpoint has stopped creating accounts. */
    @Test
    @DisplayName("a staff account naming a known team is created, and keeps it")
    void aKnownTeamIsAccepted() throws Exception {
        User founder = admin("9866050001", "team.founder@example.com");

        create(founder, """
                {"name":"Desked","mobile":"9866050002","email":"desked@example.com",
                 "role":"staff","team":"%s"}""".formatted(Teams.LEGAL))
                .andExpect(status().isCreated());

        assertThat(users.findByMobile("9866050002").orElseThrow().getTeam())
                .as("the team the maker chose is the team the map will key off")
                .isEqualTo(Teams.LEGAL);
    }

    /** {@code team} is optional in JSON, so an omitted desk is the default shape of the request. */
    @Test
    @DisplayName("a staff account with no team is refused, and told which teams exist")
    void anOmittedTeamIsRefused() throws Exception {
        User founder = admin("9866050003", "team.founder2@example.com");

        create(founder, """
                {"name":"Deskless","mobile":"9866050004","email":"deskless@example.com",
                 "role":"staff"}""")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString(Teams.VALUATION)));

        assertThat(users.findByMobile("9866050004"))
                .as("a refused request must not leave a half-made colleague behind")
                .isEmpty();
    }

    /** Blank is what an untouched form select posts; without normalisation the CHECK returns 500 not 422. */
    @Test
    @DisplayName("a blank team is refused, not stored as an empty string")
    void aBlankTeamIsRefused() throws Exception {
        User founder = admin("9866050005", "team.founder3@example.com");

        create(founder, """
                {"name":"Blank","mobile":"9866050006","email":"blank@example.com",
                 "role":"staff","team":"   "}""")
                .andExpect(status().isUnprocessableEntity());
    }

    /** Refused by name so the caller sees 422, not a 500 naming a CHECK constraint. */
    @Test
    @DisplayName("a team the platform does not recognise is refused")
    void anUnknownTeamIsRefused() throws Exception {
        User founder = admin("9866050007", "team.founder4@example.com");

        create(founder, """
                {"name":"Typo","mobile":"9866050008","email":"typo@example.com",
                 "role":"staff","team":"conveyancing"}""")
                .andExpect(status().isUnprocessableEntity());
    }

    /** Admins are keyed by the {@code admin} bundle, so a desk on them would be a fact the map never reads. */
    @Test
    @DisplayName("an administrator is created without a team")
    void anAdministratorNeedsNoTeam() throws Exception {
        User founder = admin("9866050009", "team.founder5@example.com");

        create(founder, """
                {"name":"Co-admin","mobile":"9866050010","email":"co.admin@example.com",
                 "role":"admin"}""")
                .andExpect(status().isCreated());

        assertThat(users.findByMobile("9866050010").orElseThrow().getTeam()).isNull();
    }

    /** Silently dropping the desk would let a maker believe they had scoped what is actually a wildcard. */
    @Test
    @DisplayName("a team on an administrator is refused rather than quietly dropped")
    void anAdministratorMayNotCarryATeam() throws Exception {
        User founder = admin("9866050011", "team.founder6@example.com");

        create(founder, """
                {"name":"Scoped admin","mobile":"9866050012","email":"scoped.admin@example.com",
                 "role":"admin","team":"%s"}""".formatted(Teams.RENTAL))
                .andExpect(status().isUnprocessableEntity());

        assertThat(users.findByMobile("9866050012")).isEmpty();
    }
}
