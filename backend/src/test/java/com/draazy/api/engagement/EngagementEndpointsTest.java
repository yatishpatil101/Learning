package com.draazy.api.engagement;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.JwtService;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

// Engagement slice proof: saved properties, society follows, saved searches and notifications.
// Load-bearing assertions are caller scope, idempotency, FK validation and envelope shape.
class EngagementEndpointsTest extends AbstractApiTest {

    @Autowired MockMvc mvc;
    @Autowired JwtService jwtService;
    @Autowired UserRepository users;
    @Autowired PropertyRepository properties;
    @Autowired JdbcTemplate jdbc;

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Test User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        return listing(owner, PropertyStatus.APPROVED);
    }

    private Property listing(User owner, String status) {
        Property p = new Property(owner, "Test flat", "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    private UUID societyId(String slug) {
        return jdbc.queryForObject("select id from societies where slug = ?", UUID.class, slug);
    }

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

    @Test
    void listSaved_countsOnlyBuyerVisibleRowsButKeepsSavedRows() throws Exception {
        User u = user("9820100043");
        String auth = bearer(u);
        Property approved = listing(u, PropertyStatus.APPROVED);
        Property rented = listing(u, PropertyStatus.RENTED);
        Property pending = listing(u, PropertyStatus.PENDING);
        Property paused = listing(u, PropertyStatus.PAUSED);
        Property rejected = listing(u, PropertyStatus.REJECTED);
        Property flagged = listing(u, PropertyStatus.FLAGGED);
        Property archived = listing(u, PropertyStatus.APPROVED);
        archived.archive("test");
        properties.saveAndFlush(archived);

        for (Property p : List.of(approved, rented, pending, paused, rejected, flagged, archived)) {
            mvc.perform(put("/me/saved/" + p.getId()).header(HttpHeaders.AUTHORIZATION, auth))
                    .andExpect(status().isNoContent());
        }

        String body = mvc.perform(get("/me/saved").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andReturn().getResponse().getContentAsString();
        List<String> ids = com.jayway.jsonpath.JsonPath.read(body, "$.content[*].id");
        List<String> statuses = com.jayway.jsonpath.JsonPath.read(body, "$.content[*].status");
        assertThat(ids).containsExactlyInAnyOrder(approved.getId().toString(), rented.getId().toString());
        assertThat(statuses).contains(PropertyStatus.RENTED);

        pending.setStatus(PropertyStatus.APPROVED);
        properties.saveAndFlush(pending);
        body = mvc.perform(get("/me/saved").header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andReturn().getResponse().getContentAsString();
        ids = com.jayway.jsonpath.JsonPath.read(body, "$.content[*].id");
        assertThat(ids).contains(pending.getId().toString());

        mvc.perform(delete("/me/saved/" + paused.getId()).header(HttpHeaders.AUTHORIZATION, auth))
                .andExpect(status().isNoContent());
        Integer savedRows = jdbc.queryForObject("""
                select count(*) from saved_properties where user_id = ? and property_id = ?
                """, Integer.class, u.getId(), paused.getId());
        assertThat(savedRows).isZero();
    }

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

    @Test
    void unsaveNonExistent_returns204() throws Exception {
        User u = user("9820100004");
        mvc.perform(delete("/me/saved/" + UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
    }

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

    @Test
    void unfollowWithoutFollowing_returns204() throws Exception {
        User u = user("9820100011");
        mvc.perform(delete("/me/societies/amanora-park-hadapsar/follow")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
    }

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
                .andExpect(jsonPath("$.channel").value("push"))
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

                .andExpect(jsonPath("$.query").doesNotExist());

        // The other half of the rule: flatmates without criteria is still a validation failure.
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, auth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"flatmates\",\"name\":\"empty\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void createSavedSearch_smsChannel_isAcceptedAsInApp() throws Exception {
        User u = user("9820100028");
        mvc.perform(post("/me/saved-searches")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"query\":\"2bhk Baner\",\"channel\":\"sms\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.channel").value("push"));
    }

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

    // Every legacy value the contract lists must be accepted — the pattern must not be over-tight.
    // This test is only about the accepted vocabulary, not the count limit.
    @Test
    void createSavedSearch_allContractVocabularyAccepted() throws Exception {
        int i = 0;
        for (String freq : new String[] {"off", "instant", "daily", "weekly"}) {
            for (String channel : new String[] {"whatsapp", "email", "push"}) {
                User u = user("98202001" + String.format("%02d", i++));
                mvc.perform(post("/me/saved-searches")
                                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"query\":\"q\",\"alertFrequency\":\"" + freq
                                        + "\",\"channel\":\"" + channel + "\"}"))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.alertFrequency").value(freq))
                        .andExpect(jsonPath("$.channel").value("push"));
            }
        }
    }

    // The field is `Object`, so Bean Validation cannot attach `@Size`.
    // Without this bound, every list read re-serializes unbounded JSONB.
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

    @Test
    void unreadCount_countsUnreadDeliverableOnly() throws Exception {
        User u = user("9820100044");
        jdbc.update("insert into notifications (user_id, type, title, read) values (?, 'info', 'Unread', false)",
                u.getId());
        jdbc.update("insert into notifications (user_id, type, title, read) values (?, 'info', 'Read', true)",
                u.getId());
        jdbc.update("""
                insert into notifications (user_id, type, title, read, deliver_after)
                values (?, 'info', 'Deferred', false, now() + interval '1 hour')
                """, u.getId());

        mvc.perform(get("/notifications/unread-count").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(1));
        String body = mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andReturn().getResponse().getContentAsString();
        List<Boolean> readFlags = com.jayway.jsonpath.JsonPath.read(body, "$.content[*].read");
        assertThat(readFlags).containsExactlyInAnyOrder(false, true);
    }

    @Test
    void listNotifications_hidesReadRowsOlderThanThirtyDays() throws Exception {
        User u = user("9820100045");
        jdbc.update("""
                insert into notifications (user_id, type, title, read, created_at)
                values (?, 'info', 'Old read', true, now() - interval '31 days')
                """, u.getId());
        jdbc.update("""
                insert into notifications (user_id, type, title, read, created_at)
                values (?, 'info', 'Old unread', false, now() - interval '31 days')
                """, u.getId());
        jdbc.update("""
                insert into notifications (user_id, type, title, read, created_at)
                values (?, 'info', 'Recent read', true, now() - interval '2 days')
                """, u.getId());

        String body = mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.totalElements").value(2))
                .andReturn().getResponse().getContentAsString();
        List<String> titles = com.jayway.jsonpath.JsonPath.read(body, "$.content[*].title");
        assertThat(titles).containsExactlyInAnyOrder("Old unread", "Recent read");
    }

    @Test
    void notifications_absurdSize_clamped() throws Exception {
        User u = user("9820100031");
        mvc.perform(get("/notifications?size=100000")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    // Skipping bad ids would turn an all-garbage list into "mark all read";
    // a client typo must not clear the inbox.
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

        mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.content[0].read").value(false));
    }

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

        mvc.perform(post("/notifications/read")
                        .header(HttpHeaders.AUTHORIZATION, bearer(b))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ids\":[\"" + notifA + "\"]}"))
                .andExpect(status().isNoContent());

        boolean read = jdbc.queryForObject(
                "select read from notifications where id = ?", Boolean.class, notifA);
        assertThat(read).isFalse();
    }

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

    @Test
    void dismiss_removesCallerOwnRow() throws Exception {
        User u = user("9820100039");
        UUID id = UUID.randomUUID();
        jdbc.update("insert into notifications (id, user_id, type, title) values (?, ?, 'info', 'Bye')",
                id, u.getId());

        mvc.perform(delete("/notifications/" + id).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());

        mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    @Test
    void dismiss_callerScoped_returns404() throws Exception {
        User a = user("9820100040");
        User b = user("9820100041");
        UUID notifA = UUID.randomUUID();
        jdbc.update("insert into notifications (id, user_id, type, title) values (?, ?, 'info', 'For A')",
                notifA, a.getId());

        mvc.perform(delete("/notifications/" + notifA).header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isNotFound());

        int stillThere = jdbc.queryForObject(
                "select count(*) from notifications where id = ?", Integer.class, notifA);
        assertThat(stillThere).isOne();
    }

    @Test
    void dismiss_malformedId_returns400NotServerError() throws Exception {
        User u = user("9820100042");
        mvc.perform(delete("/notifications/not-a-uuid").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isBadRequest());
    }

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
        mvc.perform(get("/notifications/unread-count")).andExpect(status().isUnauthorized());
        mvc.perform(post("/notifications/read")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/notifications/" + UUID.randomUUID())).andExpect(status().isUnauthorized());
    }
}
