package com.draazy.api.admin.staff;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/** The Staff Activity feed reads {@code audit_log}, so it needs {@code audit:read}: anything weaker opens a second
 * door. Consumers write audit rows too and must not count as staff activity. */
@DisplayName("D213 — staff activity")
class StaffActivityEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    /** Other tests' rows commit past the class rollback and the seed has none; clean both ways for counts. */
    @BeforeEach
    @AfterEach
    void clearCommittedAuditRows() {
        jdbc.update("DELETE FROM audit_log WHERE action LIKE 'd213.%'");
    }

    private User person(String mobile, String role) {
        User user = new User(mobile, role);
        user.setName("D213 " + role + " " + mobile);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private void auditRow(User actor, String role, String action, String entity) {
        auditRow(actor, role, action, entity, "{}");
    }

    private void auditRow(User actor, String role, String action, String entity, String metadata) {
        jdbc.update("INSERT INTO audit_log (id, actor, actor_role, action, entity, entity_id, metadata, at)"
                + " VALUES (gen_random_uuid(), ?, ?, ?, ?, 'X1', ?::jsonb, now())",
                actor.getId().toString(), role, action, entity, metadata);
    }

    // ---------------------------------------------------------------- the feed

    @Test
    @DisplayName("admins see each action's details; managers do not")
    void detailsAreAdminOnly() throws Exception {
        User admin = person("9878000014", Roles.Wire.ADMIN);
        User manager = person("9878000015", Roles.Wire.MANAGER);
        User staff = person("9878000016", Roles.Wire.STAFF);
        auditRow(staff, Roles.Wire.STAFF, "d213.price.change", "property", "{\"from\":100,\"to\":200}");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY)
                        .param("action", "d213.price.change")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].metadata.from").value(100))
                .andExpect(jsonPath("$.content[0].metadata.to").value(200));

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY)
                        .param("action", "d213.price.change")
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].metadata").isEmpty());
    }

    @Test
    @DisplayName("the feed names the colleague who acted rather than printing their id")
    void theFeedResolvesTheActor() throws Exception {
        User admin = person("9878000001", Roles.Wire.ADMIN);
        auditRow(admin, Roles.Wire.ADMIN, "d213.user.suspend", "user");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY)
                        .param("action", "d213.user.suspend")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].actorName").value(admin.getName()))
                .andExpect(jsonPath("$.content[0].actor").value(admin.getId().toString()))
                .andExpect(jsonPath("$.content[0].actorRole").value(Roles.Wire.ADMIN))
                .andExpect(jsonPath("$.content[0].entity").value("user"));
    }

    /** Consumers also trigger {@code user.contact.reveal}; scope is enforced in SQL, so this tests the query. */
    @Test
    @DisplayName("consumer actions are not staff activity")
    void consumerActionsAreNotStaffActivity() throws Exception {
        User admin = person("9878000002", Roles.Wire.ADMIN);
        User buyer = person("9878000003", Roles.Wire.BUYER);
        auditRow(buyer, Roles.Wire.BUYER, "d213.contact.reveal", "user");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY)
                        .param("action", "d213.contact.reveal")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    /** Unescaped, {@code %} is SQL's wildcard and would match the row below; escaped, it is literal. */
    @Test
    @DisplayName("free-text search treats a wildcard as a character, not as everything")
    void searchEscapesWildcards() throws Exception {
        User admin = person("9878000004", Roles.Wire.ADMIN);
        auditRow(admin, Roles.Wire.ADMIN, "d213.locality.update", "locality");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY)
                        .param("q", "d213.%")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // ---------------------------------------------------------------- the summary

    /** The leaderboard must count every row in the window, not just the rows one page holds. */
    @Test
    @DisplayName("the summary counts the whole window, and ranks by it")
    void theSummaryCountsTheWholeWindow() throws Exception {
        User busy = person("9878000005", Roles.Wire.ADMIN);
        User quiet = person("9878000006", Roles.Wire.STAFF);
        auditRow(busy, Roles.Wire.ADMIN, "d213.user.suspend", "user");
        auditRow(busy, Roles.Wire.ADMIN, "d213.user.flag", "user");
        auditRow(busy, Roles.Wire.ADMIN, "d213.locality.update", "locality");
        auditRow(quiet, Roles.Wire.STAFF, "d213.locality.update", "locality");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY_SUMMARY)
                        .param("q", "d213.")
                        .header(HttpHeaders.AUTHORIZATION, bearer(busy)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(4))
                .andExpect(jsonPath("$.staffCount").value(2))
                .andExpect(jsonPath("$.byEntity[0].entity").value("locality"))
                .andExpect(jsonPath("$.byEntity[0].count").value(2))
                .andExpect(jsonPath("$.leaderboard[0].name").value(busy.getName()))
                .andExpect(jsonPath("$.leaderboard[0].total").value(3))
                .andExpect(jsonPath("$.leaderboard[1].total").value(1));
    }

    /** The console's pickers are built from this; categories like {@code packers} were never audit actions. */
    @Test
    @DisplayName("the summary reports the vocabulary actually present, so filters cannot offer verbs that do not exist")
    void theSummaryReportsTheRealVocabulary() throws Exception {
        User admin = person("9878000007", Roles.Wire.ADMIN);
        auditRow(admin, Roles.Wire.ADMIN, "d213.ticket.update", "ticket");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY_SUMMARY)
                        .param("q", "d213.")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actions.length()").value(1))
                .andExpect(jsonPath("$.actions[0]").value("d213.ticket.update"));
    }

    /** Narrowing to one colleague must narrow the headline too, or the page lies above the list. */
    @Test
    @DisplayName("the summary answers for the filtered window, not the whole platform")
    void theSummaryFollowsTheFilter() throws Exception {
        User admin = person("9878000008", Roles.Wire.ADMIN);
        User other = person("9878000009", Roles.Wire.STAFF);
        auditRow(admin, Roles.Wire.ADMIN, "d213.user.suspend", "user");
        auditRow(other, Roles.Wire.STAFF, "d213.user.suspend", "user");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY_SUMMARY)
                        .param("actor", other.getId().toString())
                        .param("q", "d213.")
                        .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.staffCount").value(1))
                .andExpect(jsonPath("$.leaderboard[0].name").value(other.getName()));
    }

    @Test
    @DisplayName("managers read staff activity but not manager or admin rows")
    void managersSeeStaffActivityOnly() throws Exception {
        User manager = person("9878000011", Roles.Wire.MANAGER);
        User admin = person("9878000012", Roles.Wire.ADMIN);
        User staff = person("9878000013", Roles.Wire.STAFF);
        auditRow(manager, Roles.Wire.MANAGER, "d213.manager.action", "user");
        auditRow(admin, Roles.Wire.ADMIN, "d213.admin.action", "user");
        auditRow(staff, Roles.Wire.STAFF, "d213.staff.action", "user");

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY)
                        .param("q", "d213.")
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].actorRole").value(Roles.Wire.STAFF));
    }

    // ---------------------------------------------------------------- the guard

    @Test
    @DisplayName("staff cannot read their own review surface")
    void staffCannotReadTheirOwnReviewSurface() throws Exception {
        User staff = person("9878000010", Roles.Wire.STAFF);

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isForbidden());

        mvc.perform(get(Routes.Admin.STAFF_ACTIVITY_SUMMARY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isForbidden());
    }
}
