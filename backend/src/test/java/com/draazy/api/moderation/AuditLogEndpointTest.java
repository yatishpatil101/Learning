package com.draazy.api.moderation;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

// Feature tests read `audit_log` through JDBC, so route coverage misses
// failures in the endpoint's own SQL.
@DisplayName("Admin audit log — the unfiltered read the console opens with")
class AuditLogEndpointTest extends AbstractApiTest {

    private static final String OLD_ACTOR = "audit-log-test-old";
    private static final String RECENT_ACTOR = "audit-log-test-recent";

    private static final Instant CUT_OFF = Instant.now().minus(7, ChronoUnit.DAYS);

    @Autowired
    UserRepository users;

    private String admin() {
        User admin = new User("9820000701", Roles.Wire.ADMIN);
        admin.setName("Audit Reader");
        admin.setMobileVerified(true);
        return bearer(users.saveAndFlush(admin));
    }

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
    @DisplayName("an actor is shown by name, and an unknown handle falls back to itself")
    void actorsAreNamed() throws Exception {
        User reader = new User("9820000702", Roles.Wire.ADMIN);
        reader.setName("Named Actor");
        reader.setMobileVerified(true);
        String id = users.saveAndFlush(reader).getId().toString();
        String admin = admin();
        row(id, "user", Instant.now().minus(2, ChronoUnit.HOURS));
        seed();

        mvc.perform(get(Routes.Admin.AUDIT_LOG).header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].actorName").value("Named Actor"));

        mvc.perform(get(Routes.Admin.AUDIT_LOG).header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", RECENT_ACTOR))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].actorName").value(RECENT_ACTOR));
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

        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", OLD_ACTOR)
                        .param("from", CUT_OFF.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty());

        mvc.perform(get(Routes.Admin.AUDIT_LOG)
                        .header(HttpHeaders.AUTHORIZATION, admin)
                        .param("actor", RECENT_ACTOR)
                        .param("from", CUT_OFF.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isNotEmpty());

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
