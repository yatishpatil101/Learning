package com.punenest.api.admin.staff;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * D213 — the Staff Activity console gets a server.
 *
 * <h2>What was actually wrong</h2>
 *
 * <p>The page read a second, parallel activity log that the frontend wrote to the browser's own
 * storage at each point somebody had remembered to add a {@code logStaffActivity} call. So its
 * completeness was a property of how attentive the last person to edit a page had been, it could not
 * record an action taken through any other client, and it could not record one that failed. It also
 * ranked staff by counts folded out of whatever rows the browser had already fetched, which ranks
 * the page rather than the team.
 *
 * <p>The replacement is a read over {@code audit_log}, which the server writes inside the
 * transaction that does the work.
 *
 * <h2>The assertions that matter most</h2>
 *
 * <p>{@link #staffCannotReadTheirOwnReviewSurface()} — the whole point of the change is that this
 * is the record staff are held to. Serving it under anything weaker than the audit log's own
 * {@code audit:read} would leave a second, unlocked door into rows the first door refuses them.
 *
 * <p>{@link #consumerActionsAreNotStaffActivity()} — consumers write audit rows too. If they leaked
 * into the feed the leaderboard would rank buyers, and "active staff" would count the public.
 */
@DisplayName("D213 — staff activity")
class StaffActivityEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    /**
     * The seed database carries no audit rows, and audit rows written by other tests commit through
     * the class-level rollback. Both directions are cleaned so the counts below are counts of what
     * this test put there.
     */
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
        jdbc.update("INSERT INTO audit_log (id, actor, actor_role, action, entity, entity_id, metadata, at)"
                + " VALUES (gen_random_uuid(), ?, ?, ?, ?, 'X1', '{}', now())",
                actor.getId().toString(), role, action, entity);
    }

    // ---------------------------------------------------------------- the feed

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

    /**
     * {@code user.contact.reveal} is recorded against whoever asked, and consumers ask. The scope is
     * enforced in SQL rather than left to a filter the caller might omit, so this is a test of the
     * query and not of the console.
     */
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

    /**
     * The pattern is {@code d213.%}. Unescaped, {@code %} is SQL's "anything", so a naive
     * implementation matches the row below and the operator gets rows back believing they narrowed.
     * Escaped, it asks for a literal per-cent sign after {@code d213.} and correctly finds nothing.
     */
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

    /**
     * The leaderboard is the reason this endpoint exists rather than a second call to the audit log:
     * it has to count every row in the window, not the rows one page happens to hold.
     */
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

    /**
     * The console's category and action pickers are built from this. The mock offered a hardcoded
     * list containing {@code packers} and {@code interior} — service categories that were never
     * audit actions, so two of its six filters could only ever return nothing.
     */
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
