package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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

@DisplayName("staff account functions")
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

    @Test
    @DisplayName("a staff account stores functions and leaves the legacy team empty")
    void functionsAreAccepted() throws Exception {
        User founder = admin("9866050001", "team.founder@example.com");

        create(founder, """
                {"name":"Desked","mobile":"9866050002","email":"desked@example.com",
                 "role":"staff","functions":["desk:%s","kyc"]}""".formatted(Teams.LEGAL))
                .andExpect(status().isCreated());

        assertThat(users.findByMobile("9866050002").orElseThrow().getTeam())
                .as("desk scope now lives in back_office_permissions")
                .isNull();
        assertThat(jdbc.queryForObject("""
                SELECT permissions::text FROM back_office_permissions p
                JOIN users u ON u.id = p.user_id
                WHERE u.mobile = '9866050002'
                """, String.class)).contains("desk:legal").contains("kyc");
    }

    @Test
    @DisplayName("a staff account with no functions is created with an empty document")
    void omittedFunctionsCreateDashboardOnlyStaff() throws Exception {
        User founder = admin("9866050003", "team.founder2@example.com");

        create(founder, """
                {"name":"Deskless","mobile":"9866050004","email":"deskless@example.com",
                "role":"staff"}""")
                .andExpect(status().isCreated());

        assertThat(jdbc.queryForObject("""
                SELECT permissions::text FROM back_office_permissions p
                JOIN users u ON u.id = p.user_id
                WHERE u.mobile = '9866050004'
                """, String.class)).isEqualTo("[]");
    }

    @Test
    @DisplayName("a blank legacy team is ignored")
    void blankTeamIsIgnored() throws Exception {
        User founder = admin("9866050005", "team.founder3@example.com");

        create(founder, """
                {"name":"Blank","mobile":"9866050006","email":"blank@example.com",
                 "role":"staff","team":"   "}""")
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("an unknown function is refused")
    void anUnknownFunctionIsRefused() throws Exception {
        User founder = admin("9866050007", "team.founder4@example.com");

        create(founder, """
                {"name":"Typo","mobile":"9866050008","email":"typo@example.com",
                "role":"staff","functions":["desk:conveyancing"]}""")
                .andExpect(status().isUnprocessableEntity());
    }

    /** Administrators are bootstrapped, not created by another back-office account. */
    @Test
    @DisplayName("an administrator cannot be created here")
    void anAdministratorNeedsNoTeam() throws Exception {
        User founder = admin("9866050009", "team.founder5@example.com");

        create(founder, """
                {"name":"Co-admin","mobile":"9866050010","email":"co.admin@example.com",
                 "role":"admin"}""")
                .andExpect(status().isForbidden());

        assertThat(users.findByMobile("9866050010")).isEmpty();
    }

    @Test
    @DisplayName("a team on an administrator is also refused")
    void anAdministratorMayNotCarryATeam() throws Exception {
        User founder = admin("9866050011", "team.founder6@example.com");

        create(founder, """
                {"name":"Scoped admin","mobile":"9866050012","email":"scoped.admin@example.com",
                 "role":"admin","team":"%s"}""".formatted(Teams.RENTAL))
                .andExpect(status().isForbidden());

        assertThat(users.findByMobile("9866050012")).isEmpty();
    }
}
