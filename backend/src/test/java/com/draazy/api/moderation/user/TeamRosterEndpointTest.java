package com.draazy.api.moderation.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
import jakarta.persistence.EntityManagerFactory;
import java.util.List;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("GET /admin/team — the roster and its functions in one read")
class TeamRosterEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    EntityManagerFactory entityManagerFactory;

    private User save(String mobile, String role, String team) {
        User user = new User(mobile, role);
        user.setName("Roster probe " + mobile);
        user.setTeam(team);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private void grant(User account, String functionsJson) {
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) VALUES (?, ?::jsonb)",
                account.getId(), functionsJson);
    }

    private String token(User account) {
        return "Bearer " + jwtService.issueAccessToken(account);
    }

    private String roster(User caller) throws Exception {
        return mvc.perform(get(Routes.Admin.TEAM).header(HttpHeaders.AUTHORIZATION, token(caller)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private static <T> T field(String roster, User account, String name) {
        List<T> matches = JsonPath.read(roster, "$[?(@.id == '" + account.getId() + "')]." + name);
        assertThat(matches).hasSize(1);
        return matches.get(0);
    }

    @Test
    @DisplayName("staff are refused, whatever desk they hold")
    void staffAreRefused() throws Exception {
        User staff = save("9866040001", Roles.Wire.STAFF, Teams.RENTAL);
        grant(staff, "[\"desk:rental\"]");

        mvc.perform(get(Routes.Admin.TEAM).header(HttpHeaders.AUTHORIZATION, token(staff)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("an administrator reads the functions the per-account endpoint reports")
    void administratorSeesWhatThePerAccountReadReports() throws Exception {
        User admin = save("9866040002", Roles.Wire.ADMIN, null);
        User manager = save("9866040003", Roles.Wire.MANAGER, null);
        User scoped = save("9866040004", Roles.Wire.STAFF, Teams.RENTAL);
        User unscoped = save("9866040005", Roles.Wire.STAFF, null);
        User archived = save("9866040006", Roles.Wire.STAFF, Teams.LEGAL);
        grant(scoped, "[\"desk:rental\",\"support\"]");
        archived.archive("left");
        users.saveAndFlush(archived);

        String roster = roster(admin);

        for (User account : List.of(manager, scoped, unscoped, archived)) {
            String perAccount = mvc.perform(get(Routes.Users.PERMISSIONS
                            .replace("{id}", account.getId().toString()))
                            .header(HttpHeaders.AUTHORIZATION, token(admin)))
                    .andReturn().getResponse().getContentAsString();
            assertThat(this.<List<String>>field(roster, account, "functions"))
                    .containsExactlyInAnyOrderElementsOf(JsonPath.<List<String>>read(perAccount, "$.functions"));
        }
        assertThat(this.<List<String>>field(roster, scoped, "functions")).containsExactlyInAnyOrder("desk:rental", "support");
        assertThat(this.<List<String>>field(roster, admin, "functions")).isEmpty();
        assertThat(this.<Boolean>field(roster, archived, "archived")).isTrue();
        assertThat(this.<Boolean>field(roster, scoped, "archived")).isFalse();
        assertThat(this.<String>field(roster, scoped, "mobile")).isEqualTo(MobileMask.mask(scoped.getMobile()));
    }

    @Test
    @DisplayName("a manager reads functions for staff and itself, never for other managers or the administrator")
    void managerIsNarrowerThanAdministrator() throws Exception {
        User admin = save("9866040007", Roles.Wire.ADMIN, null);
        User manager = save("9866040008", Roles.Wire.MANAGER, null);
        User otherManager = save("9866040009", Roles.Wire.MANAGER, null);
        User staff = save("9866040010", Roles.Wire.STAFF, Teams.RENTAL);
        grant(staff, "[\"desk:rental\"]");

        String roster = roster(manager);

        assertThat(this.<List<String>>field(roster, staff, "functions")).containsExactly("desk:rental");
        assertThat(this.<List<String>>field(roster, manager, "functions")).isNotEmpty();
        assertThat(this.<List<String>>field(roster, otherManager, "functions")).isEmpty();
        assertThat(this.<List<String>>field(roster, admin, "functions")).isEmpty();
    }

    @Test
    @DisplayName("the number of statements does not grow with the number of accounts")
    void statementCountIsFlat() throws Exception {
        User admin = save("9866040011", Roles.Wire.ADMIN, null);
        grant(save("9866040012", Roles.Wire.STAFF, Teams.RENTAL), "[\"desk:rental\"]");
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.setStatisticsEnabled(true);

        roster(admin);
        statistics.clear();
        roster(admin);
        long few = statistics.getPrepareStatementCount();

        for (int i = 0; i < 12; i++) {
            User staff = save("98660500%02d".formatted(i), Roles.Wire.STAFF, Teams.RENTAL);
            grant(staff, "[\"desk:rental\"]");
        }
        statistics.clear();
        roster(admin);

        assertThat(statistics.getPrepareStatementCount()).isEqualTo(few);
    }
}
