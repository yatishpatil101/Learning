package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.List;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Flatmates — how many groups a person may be in, and leaving one")
class FlatmateMembershipEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private final List<String> createdActors = new ArrayList<>();
    private int nextMobile = 1;

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String name, String role) {
        User u = new User(String.format("98480000%02d", nextMobile++), role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private User user(String name) {
        return user(name, Roles.Wire.OWNER);
    }

    private String group(String policy) throws Exception {
        User host = user("Host");
        String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Team up in Baner","locality":"Baner","policy":"%s",
                                 "rent":30000,"seats":3,"seatsOpen":2,"name":"Host"}
                                """.formatted(policy)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        jdbc.update("update flatmate_groups set mod_status = 'approved' where id = ?::uuid", id);
        return id;
    }

    private User hostOf(String groupId) {
        return users.findById(java.util.UUID.fromString(jdbc.queryForObject(
                "select host_id::text from flatmate_groups where id = ?::uuid", String.class,
                groupId))).orElseThrow();
    }

    private ResultActions join(String groupId, User who) throws Exception {
        return mvc.perform(post(Routes.Flatmates.GROUP_JOIN, groupId)
                .header(HttpHeaders.AUTHORIZATION, bearer(who))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"));
    }

    private ResultActions leave(String groupId, User who) throws Exception {
        return mvc.perform(delete(Routes.Flatmates.GROUP_MEMBERSHIP, groupId)
                .header(HttpHeaders.AUTHORIZATION, bearer(who)));
    }

    private ResultActions setLimit(String value) throws Exception {
        return mvc.perform(put(Routes.Admin.SETTINGS)
                .header(HttpHeaders.AUTHORIZATION, bearer(user("Admin", Roles.Wire.ADMIN)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"flatmates\":{\"maxGroupsPerPerson\":" + value + "}}"));
    }

    private int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    @Test
    @DisplayName("two groups are fine; the third request is group_limit, pending asks included")
    void thirdRequestIsRefused() throws Exception {
        User seeker = user("Seeker");
        join(group("any"), seeker).andExpect(status().isCreated());
        join(group("women"), seeker).andExpect(status().isCreated());

        join(group("any"), seeker)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", Matchers.endsWith("(group_limit)")));
        assertThat(count("select count(*) from flatmate_requests where requester_id = ?::uuid",
                seeker.getId().toString())).isEqualTo(2);
    }

    @Test
    @DisplayName("groups a person hosts do not count")
    void hostedGroupsDoNotCount() throws Exception {
        String hosted = group("any");
        User host = hostOf(hosted);
        join(group("any"), host).andExpect(status().isCreated());
        join(group("any"), host).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("leaving opens the seat, tells the host, and frees a place for another group")
    void leavingFreesTheSeatAndTheSlot() throws Exception {
        User seeker = user("Leaver");
        String first = group("any");
        join(first, seeker).andExpect(status().isCreated());
        join(group("any"), seeker).andExpect(status().isCreated());
        assertThat(count("select seats_open from flatmate_groups where id = ?::uuid", first))
                .isEqualTo(1);

        leave(first, seeker).andExpect(status().isNoContent());

        assertThat(count("select seats_open from flatmate_groups where id = ?::uuid", first))
                .isEqualTo(2);
        assertThat(count("select count(*) from flatmate_group_members where group_id = ?::uuid "
                + "and user_id = ?::uuid", first, seeker.getId().toString())).isZero();
        assertThat(count("select count(*) from flatmate_requests where target_id = ?::uuid "
                + "and requester_id = ?::uuid", first, seeker.getId().toString())).isZero();
        assertThat(count("select count(*) from notifications where user_id = ?::uuid "
                + "and type = 'flatmate.group.left'", hostOf(first).getId().toString()))
                .isEqualTo(1);

        join(group("any"), seeker).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("the host cannot leave their own group, and a stranger has nothing to leave")
    void onlyMembersLeave() throws Exception {
        String id = group("any");
        leave(id, hostOf(id)).andExpect(status().isConflict());
        leave(id, user("Stranger")).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("an admin lowering the limit is re-checked when the host accepts")
    void acceptRechecksTheLimit() throws Exception {
        User seeker = user("Waiting");
        join(group("any"), seeker).andExpect(status().isCreated());
        String gated = group("women");
        join(gated, seeker).andExpect(status().isCreated());
        String requestId = jdbc.queryForObject("select id::text from flatmate_requests "
                + "where target_id = ?::uuid and requester_id = ?::uuid", String.class, gated,
                seeker.getId().toString());

        setLimit("1").andExpect(status().isOk());

        mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, requestId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(hostOf(gated)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"decision\":\"accepted\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", Matchers.endsWith("(group_limit)")));
        assertThat(count("select count(*) from flatmate_group_members where group_id = ?::uuid",
                gated)).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "11", "1.5", "\"2\""})
    @DisplayName("a limit outside 1..10, or not a whole number, is refused")
    void anUnenforceableLimitIsRefused(String value) throws Exception {
        setLimit(value)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message", containsString("flatmates.maxGroupsPerPerson")));
    }
}
