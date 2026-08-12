package com.punenest.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * {@code GET /admin/audit-log}, called the way the admin console actually calls it (D202).
 *
 * <p><strong>Why this class exists.</strong> The route had been served since V1 and had never once
 * been requested by a test <em>without filters</em> — every caller in the suite reads
 * {@code audit_log} through {@code jdbc} instead, to assert that some other feature wrote a row. So
 * the one call the console makes when an administrator opens the page, with no parameters at all,
 * was the single uncovered shape, and it answered 500 on PostgreSQL 13: {@code
 * AuditLogRepository.search} rendered each filter's null check as a bare {@code $n is null}, a
 * position that constrains the parameter's type not at all, and the server refused the statement
 * with {@code could not determine data type of parameter $5}. Route-level coverage cannot see that,
 * because the failure is in the SQL rather than in the route table.
 *
 * <p>The filtered calls are here for the same reason in reverse: the cure for an untyped parameter
 * is to name its type, and a cast written slightly wrong turns a filter into a predicate that
 * matches everything. Both halves have to be asserted or the fix is only half-checked. Each
 * timestamp assertion is scoped by {@code actor} as well, so what it proves is the window rather
 * than the contents of a table the rest of the suite also writes to.
 *
 * <p>Rows are inserted directly rather than earned by exercising a feature. This is a read endpoint
 * and what it needs is rows with known actors at known instants; driving some unrelated moderation
 * flow to obtain them would make this class's failures belong to that flow.
 */
@DisplayName("Admin audit log — the unfiltered read the console opens with")
class AuditLogEndpointTest extends AbstractApiTest {

    private static final String OLD_ACTOR = "audit-log-test-old";
    private static final String RECENT_ACTOR = "audit-log-test-recent";

    /** Comfortably between the two seeded rows, so neither boundary is a near miss. */
    private static final Instant CUT_OFF = Instant.now().minus(7, ChronoUnit.DAYS);

    @Autowired
    UserRepository users;

    private String admin() {
        User admin = new User("9820000701", Roles.Wire.ADMIN);
        admin.setName("Audit Reader");
        admin.setMobileVerified(true);
        return bearer(users.saveAndFlush(admin));
    }

    /** Rolled back with the test — {@code AbstractApiTest} is transactional and these are its own. */
    private void row(String actor, String entity, Instant at) {
        jdbc.update("""
                insert into audit_log (id, actor, actor_role, action, entity, entity_id, metadata, at)
                values (?, ?, 'admin', 'test.audit-log', ?, ?, '{}'::jsonb, cast(? as timestamptz))
                """,
                UUID.randomUUID(), actor, entity, UUID.randomUUID().toString(), at.toString());
    }

    private void seed() {
        row(OLD_ACTOR, "property", Instant.now().minus(400, ChronoUnit.DAYS));
        row(RECENT_ACTOR, "user", Instant.now().minus(1, ChronoUnit.HOURS));
    }

    @Test
    @DisplayName("no filters at all is a 200, not a 500")
    void theUnfilteredReadAnswers() throws Exception {
        String admin = admin();
        seed();

        mvc.perform(get(Routes.Admin.AUDIT_LOG).header(HttpHeaders.AUTHORIZATION, admin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.totalElements").isNumber());
    }

    @Test
    @DisplayName("the actor and entity filters still narrow")
    void theStringFiltersStillNarrow() throws Exception {
        String admin = admin();
        seed();

        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", OLD_ACTOR))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.actor == '" + RECENT_ACTOR + "')]").isEmpty())
                .andExpect(jsonPath("$.content[?(@.actor == '" + OLD_ACTOR + "')]").isNotEmpty());

        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("entity", "user"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.actor == '" + OLD_ACTOR + "')]").isEmpty());
    }

    @Test
    @DisplayName("the timestamp filters still narrow — the pair the 500 was reported against")
    void theTimestampFiltersStillNarrow() throws Exception {
        String admin = admin();
        seed();

        // A row from last year is not in "since a week ago"...
        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", OLD_ACTOR)
                        .param("from", CUT_OFF.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty());

        // ...and an hour-old row is.
        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", RECENT_ACTOR)
                        .param("from", CUT_OFF.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isNotEmpty());

        // `to` is the same claim from the other side.
        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", RECENT_ACTOR)
                        .param("to", CUT_OFF.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty());

        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", OLD_ACTOR)
                        .param("to", CUT_OFF.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isNotEmpty());
    }
}
