package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Flatmates — group threads in Messages, and the host removing a member")
class FlatmateGroupConversationEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @PersistenceContext
    EntityManager em;

    private final List<String> createdActors = new ArrayList<>();
    private int nextMobile = 1;

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String name) {
        User u = new User(String.format("98480100%02d", nextMobile++), Roles.Wire.OWNER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private String group(User host) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Chat in Baner","locality":"Baner","policy":"any",
                                 "rent":30000,"seats":3,"seatsOpen":2,"name":"Host"}
                                """))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = idIn(json);
        jdbc.update("update flatmate_groups set mod_status = 'approved' where id = ?::uuid", id);
        em.clear();
        return id;
    }

    private static String idIn(String json) {
        return json.replaceAll("(?s).*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private void join(String groupId, User who) throws Exception {
        mvc.perform(post(Routes.Flatmates.GROUP_JOIN, groupId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(who))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated());
    }

    private ResultActions open(String groupId, User who) throws Exception {
        return mvc.perform(post(Routes.Conversations.FLATMATE_GROUP, groupId)
                .header(HttpHeaders.AUTHORIZATION, bearer(who)));
    }

    private String threadOf(String groupId, User who) throws Exception {
        return idIn(open(groupId, who).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private ResultActions send(String conversationId, User who, String body) throws Exception {
        return mvc.perform(post(Routes.Conversations.REPLY, conversationId)
                .header(HttpHeaders.AUTHORIZATION, bearer(who))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"" + body + "\"}"));
    }

    private ResultActions thread(String conversationId, User who) throws Exception {
        return mvc.perform(get(Routes.Conversations.BY_ID, conversationId)
                .header(HttpHeaders.AUTHORIZATION, bearer(who)));
    }

    private ResultActions inbox(User who) throws Exception {
        return mvc.perform(get(Routes.Conversations.BASE)
                .header(HttpHeaders.AUTHORIZATION, bearer(who)));
    }

    private ResultActions markRead(String conversationId, User who) throws Exception {
        return mvc.perform(post(Routes.Conversations.READ, conversationId)
                .header(HttpHeaders.AUTHORIZATION, bearer(who)));
    }

    private ResultActions remove(String groupId, String memberId, User who) throws Exception {
        return mvc.perform(delete(Routes.Flatmates.GROUP_MEMBER, groupId, memberId)
                .header(HttpHeaders.AUTHORIZATION, bearer(who)));
    }

    private String memberId(String groupId, User who) {
        return jdbc.queryForObject("select id::text from flatmate_group_members "
                + "where group_id = ?::uuid and user_id = ?::uuid", String.class, groupId,
                who.getId().toString());
    }

    private int count(String sql, Object... args) {
        return jdbc.queryForObject(sql, Integer.class, args);
    }

    private int messageAlerts(User who) {
        return count("select count(*) from notifications where user_id = ?::uuid "
                + "and type = 'message.received'", who.getId().toString());
    }

    @Test
    @DisplayName("one thread per group; members talk in Messages and unread follows a per-member cursor")
    void membersTalkInMessages() throws Exception {
        User host = user("Host");
        User member = user("Asha Rao");
        String id = group(host);
        join(id, member);

        String conversation = threadOf(id, host);
        open(id, member).andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(conversation))
                .andExpect(jsonPath("$.kind").value("group"))
                .andExpect(jsonPath("$.groupId").value(id))
                .andExpect(jsonPath("$.groupTitle").value("Chat in Baner"))
                .andExpect(jsonPath("$.memberCount").value(2))
                .andExpect(jsonPath("$.counterpartyMobile").doesNotExist());
        assertThat(count("select count(*) from conversations where flatmate_group_id = ?::uuid", id))
                .isEqualTo(1);

        send(conversation, member, "Hi all").andExpect(status().isCreated())
                .andExpect(jsonPath("$.author").value("Asha Rao"));
        send(conversation, host, "Welcome!").andExpect(status().isCreated());
        send(conversation, member, "Anyone up for a visit?").andExpect(status().isCreated());

        assertThat(messageAlerts(host)).as("one alert per unread burst").isEqualTo(1);
        assertThat(messageAlerts(member)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select link from notifications where user_id = ?::uuid "
                + "and type = 'message.received'", String.class, host.getId().toString()))
                .isEqualTo("/messages?c=" + conversation);

        inbox(host).andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(conversation))
                .andExpect(jsonPath("$.content[0].unread").value(2))
                .andExpect(jsonPath("$.content[0].lastMessage").value("Anyone up for a visit?"));

        thread(conversation, host).andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(3))
                .andExpect(jsonPath("$.messages[0].author").value("Asha Rao"));
        markRead(conversation, host).andExpect(status().isNoContent());
        markRead(conversation, host).andExpect(status().isNoContent());

        inbox(host).andExpect(jsonPath("$.content[0].unread").value(0));
        inbox(member).andExpect(jsonPath("$.content[0].unread").value(1));

        send(conversation, member, "Saturday?").andExpect(status().isCreated());
        assertThat(messageAlerts(host)).as("caught up, so the next message alerts again").isEqualTo(2);
    }

    @Test
    @DisplayName("a late joiner starts at zero unread and is alerted by the next message")
    void lateJoinerStartsCaughtUp() throws Exception {
        User host = user("Host");
        User early = user("Early");
        User late = user("Late");
        String id = group(host);
        join(id, early);
        String conversation = threadOf(id, host);
        send(conversation, early, "Before you came").andExpect(status().isCreated());
        send(conversation, host, "Still before").andExpect(status().isCreated());

        join(id, late);
        inbox(late).andExpect(jsonPath("$.content[0].id").value(conversation))
                .andExpect(jsonPath("$.content[0].unread").value(0));

        send(conversation, early, "Welcome, Late").andExpect(status().isCreated());
        inbox(late).andExpect(jsonPath("$.content[0].unread").value(1));
        assertThat(messageAlerts(late)).isEqualTo(1);
        thread(conversation, late).andExpect(jsonPath("$.messages.length()").value(3));
    }

    @Test
    @DisplayName("a stranger cannot open, read or write a group thread")
    void onlyMembers() throws Exception {
        User host = user("Host");
        String id = group(host);
        String conversation = threadOf(id, host);
        User stranger = user("Stranger");

        open(id, stranger).andExpect(status().isNotFound());
        open(UUID.randomUUID().toString(), host).andExpect(status().isNotFound());
        thread(conversation, stranger).andExpect(status().isNotFound());
        send(conversation, stranger, "hello").andExpect(status().isNotFound());
        markRead(conversation, stranger).andExpect(status().isNotFound());
        inbox(stranger).andExpect(jsonPath("$.content.length()").value(0));
        thread(conversation, host).andExpect(status().isOk())
                .andExpect(jsonPath("$.messages.length()").value(0));
    }

    @Test
    @DisplayName("the host removes a member: seat reopens, request declined, thread closed to them")
    void hostRemovesAMember() throws Exception {
        User host = user("Host");
        User member = user("Removed");
        String id = group(host);
        join(id, member);
        String conversation = threadOf(id, member);
        send(conversation, member, "bye soon").andExpect(status().isCreated());

        mvc.perform(get(Routes.Flatmates.GROUP_BY_ID, id))
                .andExpect(jsonPath("$.item.members[1].id").value(memberId(id, member)))
                .andExpect(jsonPath("$.item.members[0].host").value(true))
                .andExpect(jsonPath("$.item.members[1].host").value(false));

        remove(id, memberId(id, member), host).andExpect(status().isNoContent());

        assertThat(count("select seats_open from flatmate_groups where id = ?::uuid", id)).isEqualTo(2);
        assertThat(jdbc.queryForObject("select status from flatmate_requests where target_id = ?::uuid "
                + "and requester_id = ?::uuid", String.class, id, member.getId().toString()))
                .isEqualTo("declined");
        assertThat(count("select count(*) from notifications where user_id = ?::uuid "
                + "and type = 'flatmate.group.removed'", member.getId().toString())).isEqualTo(1);
        thread(conversation, member).andExpect(status().isNotFound());
        open(id, member).andExpect(status().isNotFound());
        inbox(member).andExpect(jsonPath("$.content.length()").value(0));
        thread(conversation, host).andExpect(jsonPath("$.messages[0].author").value("Removed"))
                .andExpect(jsonPath("$.memberCount").value(1));
        mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(member))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("only the host removes, and never themselves")
    void onlyTheHostRemoves() throws Exception {
        User host = user("Host");
        User member = user("Member");
        String id = group(host);
        join(id, member);

        remove(id, memberId(id, host), member).andExpect(status().isNotFound());
        remove(id, memberId(id, host), host).andExpect(status().isConflict());
        remove(id, UUID.randomUUID().toString(), host).andExpect(status().isNotFound());
        assertThat(count("select count(*) from flatmate_group_members where group_id = ?::uuid", id))
                .isEqualTo(2);
    }
}
