package com.draazy.api.moderation.conversation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.leads.contact.ContactRequest;
import com.draazy.api.leads.contact.ContactRequestRepository;
import com.draazy.api.leads.contact.ContactRequestStatuses;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import com.draazy.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * D53 — the audited moderation read of a private conversation.
 *
 * <p>The row this closes described a hole with a very specific shape: a conversation was readable by
 * its two participants and nobody else, so a chat that had been <em>reported</em> could not be read
 * by the desk that had to rule on the report. The obvious fix — {@code || isOps(caller)} inside the
 * participant guard — is the one the row explicitly warns against, and this class is organised
 * around the two properties that make the separate endpoint worth the extra file rather than around
 * its single handler:
 *
 * <ol>
 *   <li><strong>The participant guard did not move.</strong> Everything about who may read
 *       {@code GET /messages/{id}} is unchanged, and the new door is a different door with a
 *       different key.</li>
 *   <li><strong>Nobody walks through it unrecorded.</strong> A moderation power that leaves no trace
 *       is indistinguishable from an insider reading strangers' messages for fun, and the
 *       distinction is the whole justification for granting it.</li>
 * </ol>
 *
 * <p>The 403-for-staff case is the load-bearing one and the easiest to read as pedantry: staff pass
 * the role gate on this endpoint, exactly like they do on every neighbouring moderation route, and
 * are stopped only by the {@code conversations:read} atom. Delete that test and the permission atom
 * becomes decorative — the guard would still compile, still look admin-gated, and admit the whole
 * ops floor.
 */
@DisplayName("D53 — moderation may read a reported conversation, and only on the record")
class ModeratedConversationEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    ContactRequestRepository contactRequests;

    /**
     * Audit writes run in {@code REQUIRES_NEW}, so they survive this test's rollback and would
     * otherwise accumulate in a database a second agent is also using. Same treatment as
     * {@code ModerationBehaviourTest}: scope every assertion to one entity id, and clean up by
     * actor here.
     */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    @Nested
    @DisplayName("who may open the moderation door")
    class Authorisation {

        @Test
        @DisplayName("an admin may read a conversation they are not in")
        void adminMayRead() throws Exception {
            Fixture f = threadOfTwo("9840000101", "9840000102");
            User admin = user("9840000103", Roles.Wire.ADMIN, "Admin");

            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(f.conversationId))
                    .andExpect(jsonPath("$.participants", hasSize(2)))
                    .andExpect(jsonPath("$.messages", hasSize(2)));
        }

        /**
         * The atom, not the role, is what stops them — staff clear
         * {@code hasAnyRole('staff','admin')} on this route just as they do on the review and
         * property moderation routes beside it. A 403 here proves {@code conversations:read} is
         * doing work; a 200 would mean the permission model is scenery.
         */
        @Test
        @DisplayName("a staffer is refused — the permission atom is admin-only, and load-bearing")
        void staffRefusedByThePermissionAtom() throws Exception {
            Fixture f = threadOfTwo("9840000104", "9840000105");
            User desk = user("9840000106", Roles.Wire.STAFF, "Desk", Teams.LEGAL);

            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("an ordinary user is refused even for their own thread — this is not their door")
        void participantRefused() throws Exception {
            Fixture f = threadOfTwo("9840000107", "9840000108");

            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(f.buyer)))
                    .andExpect(status().isForbidden());
        }

        /**
         * A 404 rather than a 400 for a well-formed id that matches nothing, and for a string that is
         * not a uuid at all — the same answer for both, so that an admin script cannot be used to
         * probe id space.
         */
        @Test
        @DisplayName("an unknown or malformed id is a 404, not a 400")
        void unknownIsNotFound() throws Exception {
            User admin = user("9840000109", Roles.Wire.ADMIN, "Admin Two");

            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION,
                            "11111111-1111-1111-1111-111111111111")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isNotFound());
            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, "not-a-uuid")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isNotFound());
        }

        /**
         * The regression this whole file exists to prevent. If a later author decides the tidy fix is
         * a role check inside {@code mine}, this goes red: staff and admin remain strangers to
         * {@code GET /messages/{id}} and get the same 404 a stranger does.
         */
        @Test
        @DisplayName("the participant guard on GET /messages/{id} is untouched — even for an admin")
        void participantGuardStillRefusesOps() throws Exception {
            Fixture f = threadOfTwo("9840000110", "9840000111");
            User admin = user("9840000112", Roles.Wire.ADMIN, "Admin Three");
            User desk = user("9840000113", Roles.Wire.STAFF, "Desk Two", Teams.LEGAL);

            mvc.perform(get(Routes.Conversations.BY_ID, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isNotFound());
            mvc.perform(get(Routes.Conversations.BY_ID, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("the record it leaves")
    class Accountability {

        @Test
        @DisplayName("every successful read writes an audit row naming the reader and the thread")
        void readIsAudited() throws Exception {
            Fixture f = threadOfTwo("9840000114", "9840000115");
            User admin = user("9840000116", Roles.Wire.ADMIN, "Admin Four");

            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isOk());

            List<Map<String, Object>> rows = jdbc.queryForList(
                    "select actor, actor_role, entity, metadata->>'messages' as messages "
                            + "from audit_log where action = ? and entity_id = ?",
                    ModeratedConversationService.ACTION, f.conversationId);
            assertThat(rows).hasSize(1);
            assertThat(rows.get(0).get("actor")).isEqualTo(admin.getId().toString());
            assertThat(rows.get(0).get("actor_role")).isEqualTo(Roles.Wire.ADMIN);
            assertThat(rows.get(0).get("entity")).isEqualTo("conversation");
            assertThat(rows.get(0).get("messages")).isEqualTo("2");
        }

        /**
         * Two reads, two rows. Recording only the first would turn the log into "an admin looked at
         * this once", which answers the wrong question — the one a complaint asks is how often, and
         * when.
         */
        @Test
        @DisplayName("a second read is a second row, not a no-op")
        void everyReadIsRecorded() throws Exception {
            Fixture f = threadOfTwo("9840000117", "9840000118");
            User admin = user("9840000119", Roles.Wire.ADMIN, "Admin Five");

            for (int i = 0; i < 2; i++) {
                mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                                .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                        .andExpect(status().isOk());
            }

            assertThat(auditCount(f.conversationId)).isEqualTo(2);
        }

        /** A refused read is not a read, so it must not manufacture evidence of one. */
        @Test
        @DisplayName("a refused read writes nothing")
        void refusedReadIsNotAudited() throws Exception {
            Fixture f = threadOfTwo("9840000120", "9840000121");
            User desk = user("9840000122", Roles.Wire.STAFF, "Desk Three", Teams.LEGAL);

            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(desk)))
                    .andExpect(status().isForbidden());

            assertThat(auditCount(f.conversationId)).isZero();
        }
    }

    @Nested
    @DisplayName("what it shows")
    class Projection {

        /**
         * {@code Conversation} is reader-relative — {@code counterpartyName} means "the other one",
         * which is meaningless to somebody in neither seat. The moderation shape names both sides
         * absolutely, and deliberately carries no mobile number: a moderator has not passed the
         * contact gate, and reading a reported chat is not a reason to hand over both parties'
         * numbers.
         */
        @Test
        @DisplayName("both participants are named absolutely, and no mobile number is disclosed")
        void participantsAreAbsolute() throws Exception {
            Fixture f = threadOfTwo("9840000123", "9840000124");
            User admin = user("9840000125", Roles.Wire.ADMIN, "Admin Six");

            String json = mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.participants[*].name")
                            .value(org.hamcrest.Matchers.containsInAnyOrder("Owner", "Buyer")))
                    .andReturn().getResponse().getContentAsString();

            assertThat(json).doesNotContain("9840000123").doesNotContain("9840000124");
            assertThat(json).doesNotContain("counterpartyName");
        }

        /**
         * The read must not disturb the thread. If it cleared an unread flag or touched
         * {@code lastMessage}, a participant could tell from their own screen that a moderator had
         * been in — which is a notification channel nobody designed and a tip-off to the party being
         * investigated.
         */
        @Test
        @DisplayName("reading as a moderator does not clear the participants' unread flags")
        void readIsInvisibleToTheParticipants() throws Exception {
            Fixture f = threadOfTwo("9840000126", "9840000127");
            User admin = user("9840000128", Roles.Wire.ADMIN, "Admin Seven");

            int before = unreadFor(f.buyer);
            mvc.perform(get(Routes.Moderation.ADMIN_CONVERSATION, f.conversationId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isOk());

            assertThat(unreadFor(f.buyer)).isEqualTo(before);
        }
    }

    // --- fixtures -------------------------------------------------------------------------

    /** A real thread with two messages, built through the API so the guards are the live ones. */
    private record Fixture(User owner, User buyer, String conversationId) {
    }

    private Fixture threadOfTwo(String ownerMobile, String buyerMobile) throws Exception {
        User owner = user(ownerMobile, Roles.Wire.OWNER, "Owner");
        User buyer = user(buyerMobile, Roles.Wire.BUYER, "Buyer");
        Property p = listing(owner);
        ContactRequest cr = new ContactRequest(p.getId(), buyer.getId(), "interested");
        cr.setStatus(ContactRequestStatuses.APPROVED);
        contactRequests.saveAndFlush(cr);

        String created = mvc.perform(post(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"counterpartyMobile\":\"" + owner.getMobile() + "\","
                                + "\"propertyId\":\"" + p.getId() + "\","
                                + "\"body\":\"is it still available\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = created.replaceAll("(?s)^.*?\"id\":\"([^\"]+)\".*$", "$1");

        mvc.perform(post(Routes.Conversations.REPLY, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"yes it is\"}"))
                .andExpect(status().isCreated());
        return new Fixture(owner, buyer, id);
    }

    private int auditCount(String conversationId) {
        Integer n = jdbc.queryForObject(
                "select count(*) from audit_log where action = ? and entity_id = ?",
                Integer.class, ModeratedConversationService.ACTION, conversationId);
        return n == null ? 0 : n;
    }

    private int unreadFor(User reader) throws Exception {
        String json = mvc.perform(get(Routes.Conversations.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(reader)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return Integer.parseInt(json.replaceAll("(?s)^.*?\"unread\":(\\d+).*$", "$1"));
    }

    private User user(String mobile, String role, String name) {
        return user(mobile, role, name, null);
    }

    private User user(String mobile, String role, String name, String team) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setTeam(team);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "2BHK in Kothrud", "rent", "apartment", 25000L,
                "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }
}
