package com.punenest.api.engagement;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.JwtService;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Contract + behaviour proof for the Engagement slice (8a-8d): saved properties, society follows,
 * saved searches, and notifications.
 *
 * <p>The load-bearing assertions here are caller-scoping (user A never sees user B's rows),
 * idempotency (PUT twice = one row, DELETE on absent = 204), FK validation (saving a non-existent
 * property = 404), and the PageEnvelope shape for notifications.
 */
class EngagementEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired JdbcTemplate jdbc;

    // ---- fixtures ----

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Test User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "Test flat", "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setStatus("approved");
        return properties.saveAndFlush(p);
    }

    private UUID societyId(String slug) {
        return jdbc.queryForObject("select id from societies where slug = ?", UUID.class, slug);
    }

    // ========================= 8a  Saved properties =========================
    //
    // Paged as of the API-polish pass: nothing caps a shortlist, and each row is a 22-field
    // PropertySummary. Assertions read `$.content` and `$.totalElements` rather than `$` — note
    // that `$.length()` against an envelope silently returns the number of envelope *fields*, so a
    // stale assertion of this kind fails with a confusing number rather than a helpful one.

    @Test
    void listSaved_emptyByDefault() throws Exception {
        User u = user("9820100001");
        mvc.perform(get("/me/saved").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void saveAndListProperty() throws Exception {
        User u = user("9820100002");
        Property p = listing(u);

        mvc.perform(put("/me/saved/" + p.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());

        mvc.perform(get("/me/saved").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(p.getId().toString()))
                .andExpect(jsonPath("$.content[0].title").value("Test flat"));
    }

    /** Invariant 4: PUT twice = one row, still 204. */
    @Test
    void saveTwice_idempotent() throws Exception {
        User u = user("9820100003");
        Property p = listing(u);
        String auth = bearer(u);

        mvc.perform(put("/me/saved/" + p.getId()).header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());
        mvc.perform(put("/me/saved/" + p.getId()).header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());

        mvc.perform(get("/me/saved").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    /** Invariant 4: DELETE on non-existent = 204. */
    @Test
    void unsaveNonExistent_returns204() throws Exception {
        User u = user("9820100004");
        mvc.perform(delete("/me/saved/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
    }

    /** Invariant 7: saving a non-existent property -> 404 (not a dangling FK / 500). */
    @Test
    void saveNonExistentProperty_returns404() throws Exception {
        User u = user("9820100005");
        mvc.perform(put("/me/saved/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound());
    }

    /** Invariant 1: user A cannot see user B's saved properties. */
    @Test
    void savedProperties_callerScoped() throws Exception {
        User a = user("9820100006");
        User b = user("9820100007");
        Property p = listing(a);

        mvc.perform(put("/me/saved/" + p.getId()).header(HttpHeaders.AUTHORIZATION, bearer(a)))
                .andExpect(status().isNoContent());

        mvc.perform(get("/me/saved").header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void unsaveProperty() throws Exception {
        User u = user("9820100008");
        Property p = listing(u);
        String auth = bearer(u);

        mvc.perform(put("/me/saved/" + p.getId()).header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/me/saved/" + p.getId()).header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());
        mvc.perform(get("/me/saved").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // ========================= 8b  Society follow =========================

    /** Invariant 4: PUT twice = 204, one row. */
    @Test
    void followSociety_idempotent() throws Exception {
        User u = user("9820100010");
        String auth = bearer(u);
        String slug = "amanora-park-hadapsar";

        mvc.perform(put("/me/societies/" + slug + "/follow")
                        .header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());
        mvc.perform(put("/me/societies/" + slug + "/follow")
                        .header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());

        int count = jdbc.queryForObject(
                "select count(*) from society_follows where user_id = ? and society_id = ?",
                Integer.class, u.getId(), societyId(slug));
        assertThat(count).isOne();
    }

    /** Invariant 4: unfollow on non-existent = 204. */
    @Test
    void unfollowWithoutFollowing_returns204() throws Exception {
        User u = user("9820100011");
        mvc.perform(delete("/me/societies/amanora-park-hadapsar/follow")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
    }

    /** Invariant 7: following a non-existent society slug -> 404. */
    @Test
    void followNonExistentSociety_returns404() throws Exception {
        User u = user("9820100012");
        mvc.perform(put("/me/societies/no-such-society/follow")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound());
    }

    @Test
    void followThenUnfollow() throws Exception {
        User u = user("9820100013");
        String auth = bearer(u);
        String slug = "amanora-park-hadapsar";

        mvc.perform(put("/me/societies/" + slug + "/follow")
                        .header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());
        mvc.perform(delete("/me/societies/" + slug + "/follow")
                        .header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());

        int count = jdbc.queryForObject(
                "select count(*) from society_follows where user_id = ?",
                Integer.class, u.getId());
        assertThat(count).isZero();
    }

    // ========================= 8c  Saved searches =========================

    @Test
    void createAndListSavedSearch() throws Exception {
        User u = user("9820100020");
        String auth = bearer(u);

        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"2BHK Kothrud\",\"name\":\"My search\",\"filters\":{\"bhk\":2}}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNotEmpty())
                .andExpect(jsonPath("$.query").value("2BHK Kothrud"))
                .andExpect(jsonPath("$.name").value("My search"))
                .andExpect(jsonPath("$.alertFrequency").value("daily"))
                .andExpect(jsonPath("$.channel").value("whatsapp"))
                .andExpect(jsonPath("$.newCount").value(0));

        mvc.perform(get("/me/saved-searches").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
    }

    /** Invariant 1: user A cannot see user B's saved searches. */
    @Test
    void savedSearches_callerScoped() throws Exception {
        User a = user("9820100021");
        User b = user("9820100022");

        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(a))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"3BHK Baner\"}"))
                .andExpect(status().isCreated());

        mvc.perform(get("/me/saved-searches").header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    /** Invariant 1: acting on another user's saved search returns 404, not 403. */
    @Test
    void deleteSavedSearch_anotherUser_returns404() throws Exception {
        User a = user("9820100023");
        User b = user("9820100024");

        String body = mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(a))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"1BHK Hadapsar\"}"))
                .andReturn().getResponse().getContentAsString();
        String id = com.jayway.jsonpath.JsonPath.read(body, "$.id");

        mvc.perform(delete("/me/saved-searches/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isNotFound());
    }

    @Test
    void deleteSavedSearch() throws Exception {
        User u = user("9820100025");
        String auth = bearer(u);

        String body = mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"studio Wakad\"}"))
                .andReturn().getResponse().getContentAsString();
        String id = com.jayway.jsonpath.JsonPath.read(body, "$.id");

        mvc.perform(delete("/me/saved-searches/" + id)
                        .header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());

        mvc.perform(get("/me/saved-searches").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void createSavedSearch_missingQuery_returns422() throws Exception {
        User u = user("9820100026");
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"no query\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    /**
     * A flatmates alert carries a {@code criteria} object and no query string.
     *
     * <p>Before V27 this was impossible twice over: {@code query} was {@code NOT NULL} in the
     * schema and {@code @NotBlank} on the request, so every flatmate alert the UI tried to save
     * came back 422. The requirement did not disappear — it became conditional on {@code kind}.
     */
    @Test
    void createSavedSearch_flatmatesKind_needsCriteriaNotQuery() throws Exception {
        User u = user("9820100027");
        String auth = bearer(u);

        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"kind":"flatmates","name":"Baner, verified",
                                 "criteria":{"tab":"move-in","locality":"Baner","verifiedOnly":true}}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.kind").value("flatmates"))
                .andExpect(jsonPath("$.criteria.locality").value("Baner"))
                // No query string, and none invented to fill the column.
                .andExpect(jsonPath("$.query").doesNotExist());

        // The other half of the rule: flatmates without criteria is still a validation failure.
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"flatmates\",\"name\":\"empty\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    /** {@code sms} is in the contract's channel enum but was missing from V8's CHECK until V27. */
    @Test
    void createSavedSearch_smsChannel_isAccepted() throws Exception {
        User u = user("9820100028");
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"2bhk Baner\",\"channel\":\"sms\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.channel").value("sms"));
    }

    /**
     * Regression (slice-8 review): {@code alertFrequency} and {@code channel} are pattern-validated
     * at the edge. Before the fix they were passed straight through to a column with a CHECK
     * constraint, so a typo became a constraint violation and surfaced as a 500 — a server error
     * any authenticated caller could trigger.
     */
    @Test
    void createSavedSearch_invalidAlertFrequency_returns422NotServerError() throws Exception {
        User u = user("9820100027");
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"2BHK\",\"alertFrequency\":\"hourly\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    /** Same guard on the delivery channel. */
    @Test
    void createSavedSearch_invalidChannel_returns422NotServerError() throws Exception {
        User u = user("9820100028");
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"2BHK\",\"channel\":\"telegram\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    /** Every value the contract lists must be accepted — the pattern must not be over-tight. */
    @Test
    void createSavedSearch_allContractVocabularyAccepted() throws Exception {
        User u = user("9820100029");
        String auth = bearer(u);
        for (String freq : new String[] {"off", "instant", "daily", "weekly"}) {
            for (String channel : new String[] {"whatsapp", "email", "push"}) {
                mvc.perform(post("/me/saved-searches")
                                .header(HttpHeaders.AUTHORIZATION, auth)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"query\":\"q\",\"alertFrequency\":\"" + freq
                                        + "\",\"channel\":\"" + channel + "\"}"))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.alertFrequency").value(freq))
                        .andExpect(jsonPath("$.channel").value(channel));
            }
        }
    }

    /**
     * Regression (slice-8 security review): the free-form {@code filters} object is size-bounded.
     *
     * <p>It is typed {@code Object} to match the contract, so Bean Validation has nothing to hang a
     * {@code @Size} on and the column is unbounded {@code jsonb}. Without an explicit bound an
     * authenticated caller could store a multi-megabyte document per saved search, unbounded in
     * count, and have it re-serialized into the response on every list read.
     */
    @Test
    void createSavedSearch_oversizedFilters_returns400() throws Exception {
        User u = user("9820100033");
        String hugeValue = "x".repeat(9000);
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"q\",\"filters\":{\"blob\":\"" + hugeValue + "\"}}"))
                .andExpect(status().isBadRequest());

        mvc.perform(get("/me/saved-searches").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.length()").value(0));
    }

    /** A realistic facet set is well inside the bound and must still be accepted. */
    @Test
    void createSavedSearch_normalFiltersAccepted() throws Exception {
        User u = user("9820100034");
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"2BHK Kothrud\",\"filters\":"
                                + "{\"bhk\":2,\"maxPrice\":9000000,\"locality\":\"kothrud\"}}"))
                .andExpect(status().isCreated());
    }

    // ========================= 8d  Notifications =========================

    @Test
    void listNotifications_pagedShape() throws Exception {
        User u = user("9820100030");
        jdbc.update("insert into notifications (user_id, type, title, body) values (?, 'info', 'Hello', 'World')",
                u.getId());
        jdbc.update("insert into notifications (user_id, type, title, body) values (?, 'price_drop', 'Price drop', 'Check it out')",
                u.getId());

        mvc.perform(get("/notifications")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.totalPages").value(1));
    }

    /** Invariant 5: absurd size is clamped to 100. */
    @Test
    void notifications_absurdSize_clamped() throws Exception {
        User u = user("9820100031");
        mvc.perform(get("/notifications?size=100000")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    /**
     * Regression (slice-8 review): a malformed id in the mark-read body is a 400, not a 500.
     *
     * <p>The naive alternatives are both wrong. Raw {@code UUID.fromString} throws
     * {@code IllegalArgumentException}, which the global handler can only render as a 500. Silently
     * skipping unparseable ids is worse still: an all-garbage list would arrive empty, and an empty
     * list is the signal for "mark <em>all</em> read" — so a client typo would clear the inbox.
     *
     * <p>The 400 is also the deliberate exception to {@code Ids}' 404-for-a-bad-id rule, which
     * governs path tokens only — see {@code NotificationController.parseId} (tech-debt D74). This
     * test is what pins that decision, so changing the status here should mean changing it there.
     * The token itself must not come back in the body.
     */
    @Test
    void markRead_malformedId_returns400NotServerError() throws Exception {
        User u = user("9820100032");
        jdbc.update("insert into notifications (user_id, type, title, body) values (?, 'info', 'Keep me', 'unread')",
                u.getId());

        mvc.perform(post("/notifications/read")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"not-a-uuid\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(not(containsString("not-a-uuid"))));

        // and the inbox was NOT silently marked read
        mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.content[0].read").value(false));
    }

    /** Invariant 5: hostile ?sort=nosuchfield is ignored, not 500. */
    @Test
    void notifications_hostileSort_ignored() throws Exception {
        User u = user("9820100032");
        mvc.perform(get("/notifications?sort=nosuchfield")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk());
    }

    /** Invariant 2: mark-read with specific ids only touches the caller's rows. */
    @Test
    void markRead_specificIds_callerScoped() throws Exception {
        User a = user("9820100033");
        User b = user("9820100034");

        UUID notifA = UUID.randomUUID();
        UUID notifB = UUID.randomUUID();
        jdbc.update("insert into notifications (id, user_id, type, title) values (?, ?, 'info', 'For A')",
                notifA, a.getId());
        jdbc.update("insert into notifications (id, user_id, type, title) values (?, ?, 'info', 'For B')",
                notifB, b.getId());

        // B tries to mark A's notification read
        mvc.perform(post("/notifications/read")
                        .header(HttpHeaders.AUTHORIZATION, bearer(b))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + notifA + "\"]}"))
                .andExpect(status().isNoContent());

        boolean read = jdbc.queryForObject(
                "select read from notifications where id = ?", Boolean.class, notifA);
        assertThat(read).isFalse();
    }

    /** Invariant 3: mark-read with no body marks all of the caller's, and nobody else's. */
    @Test
    void markAllRead_callerScoped() throws Exception {
        User a = user("9820100035");
        User b = user("9820100036");

        jdbc.update("insert into notifications (user_id, type, title) values (?, 'info', 'A1')", a.getId());
        jdbc.update("insert into notifications (user_id, type, title) values (?, 'info', 'A2')", a.getId());
        jdbc.update("insert into notifications (user_id, type, title) values (?, 'info', 'B1')", b.getId());

        mvc.perform(post("/notifications/read")
                        .header(HttpHeaders.AUTHORIZATION, bearer(a)))
                .andExpect(status().isNoContent());

        int aUnread = jdbc.queryForObject(
                "select count(*) from notifications where user_id = ? and read = false",
                Integer.class, a.getId());
        assertThat(aUnread).isZero();

        int bUnread = jdbc.queryForObject(
                "select count(*) from notifications where user_id = ? and read = false",
                Integer.class, b.getId());
        assertThat(bUnread).isOne();
    }

    /** Invariant 1: user A cannot see user B's notifications. */
    @Test
    void notifications_callerScoped() throws Exception {
        User a = user("9820100037");
        User b = user("9820100038");

        jdbc.update("insert into notifications (user_id, type, title) values (?, 'info', 'Only A')", a.getId());

        mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    // ========================= Auth required =========================

    @Test
    void allEngagementEndpoints_requireAuth() throws Exception {
        mvc.perform(get("/me/saved")).andExpect(status().isUnauthorized());
        mvc.perform(put("/me/saved/" + UUID.randomUUID())).andExpect(status().isUnauthorized());
        mvc.perform(delete("/me/saved/" + UUID.randomUUID())).andExpect(status().isUnauthorized());
        mvc.perform(put("/me/societies/some-slug/follow")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/me/societies/some-slug/follow")).andExpect(status().isUnauthorized());
        mvc.perform(get("/me/saved-searches")).andExpect(status().isUnauthorized());
        mvc.perform(post("/me/saved-searches")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"x\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(delete("/me/saved-searches/" + UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/notifications")).andExpect(status().isUnauthorized());
        mvc.perform(post("/notifications/read")).andExpect(status().isUnauthorized());
    }
}
