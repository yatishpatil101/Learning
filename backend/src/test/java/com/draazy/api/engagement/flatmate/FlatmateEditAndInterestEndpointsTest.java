package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.PersonalDocument;
import com.draazy.api.documents.vault.PersonalDocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmates — publishing, editing, and taking an interest back")
class FlatmateEditAndInterestEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PersonalDocumentRepository personalDocuments;

    @Autowired
    EntityManager entityManager;

    /** Audit writes run {@code REQUIRES_NEW} and escape this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String roomBody(String locality, String society, long rentShare) {
        return """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"%s","society":"%s","rentShare":%d,
                 "deposit":30000,"availableFrom":"2026-09-01","lookingFor":"any",
                 "foodPref":"any","photos":["https://cdn.example/1.jpg"],
                 "hostRole":"owner",
                 "note":"Sunny room, quiet building."}
                """.formatted(locality, society, rentShare);
    }

    private String liveRoomBody(User host, String locality, String society, long rentShare) {
        return roomBody(locality, society, rentShare)
                .replace("\"hostRole\":\"owner\"",
                        "\"hostRole\":\"tenant\",\"agreementDeclared\":true,"
                                + agreementEvidence(host));
    }

    private String groupBody(User host, String title, String locality, String policy,
        // `agreement` is what makes this tenant tier, and tenant tier is what publishes. An
        // unpublished group cannot be joined: `findVisible` answers 404 for it.
            int seats, int seatsOpen) {
        return """
                {"title":"%s","locality":"%s","policy":"%s","rent":40000,"agreement":true,
                 "seats":%d,"seatsOpen":%d,"name":"Host","tags":["Vegetarian"],%s}
                """.formatted(title, locality, policy, seats, seatsOpen,
                agreementEvidence(host));
    }

    private static String idOf(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String agreementEvidence(User host) {
        PersonalDocument doc = personalDocuments.saveAndFlush(new PersonalDocument(host.getId(),
                "Registered Leave and Licence", "leave-and-licence.pdf",
                "personal/" + host.getId() + "/" + UUID.randomUUID(),
                184320L, "application/pdf"));
        return FlatmateAgreementFixture.evidence(doc.getId().toString());
    }

    private String approved(String table, String id) {
        jdbc.update("update " + table + " set mod_status = 'approved' where id = ?::uuid", id);
        entityManager.clear();
        return id;
    }

    private String createRoom(User host, String locality, String society) throws Exception {
        return approved("flatmate_rooms", postRoom(host, locality, society));
    }

    private String postRoom(User host, String locality, String society) throws Exception {
        return idOf(mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(liveRoomBody(host, locality, society, 15000)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private String createGroup(User host, String title, String locality) throws Exception {
        return createGroup(host, title, locality, "women", 3, 1);
    }

    private String createGroup(User host, String title, String locality, String policy,
            int seats, int seatsOpen) throws Exception {
        return approved("flatmate_groups", idOf(mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(groupBody(host, title, locality, policy, seats, seatsOpen)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()));
    }

    @Nested
    @DisplayName("A newly written post")
    class Publishing {

        @Test
        @DisplayName("waits for Ops even when the host backed it with an agreement")
        void aTenantTierPostWaits() throws Exception {
            User host = user("9811000101", "Tenant Host");
            String id = postRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "Baner").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(id))));
        }

        @Test
        @DisplayName("waits for Ops when the host asserted nothing beyond being signed in")
        void anIdentityTierPostWaits() throws Exception {
            User host = user("9811000102", "Bare Host");
            String id = idOf(mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(roomBody("Kothrud", "Anon Residency", 15000)))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString());

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "Kothrud").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(id))));
        }
    }

    @Nested
    @DisplayName("Editing a post")
    class Editing {

        @Test
        @DisplayName("changes the room the seeker sees, without a new id")
        void aRoomEditKeepsItsIdentity() throws Exception {
            User host = user("9811000103", "Edit Host");
            String id = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(liveRoomBody(host, "Baner", "Sunrise Heights", 17500)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(id))

                    .andExpect(jsonPath("$.budget").value(17500));
        }

        @Test
        @DisplayName("corrects how many people live in the flat, and leaves it alone when absent")
        void aRoomEditCarriesTheFlatsOccupancy() throws Exception {
            User host = user("9811000127", "Occupancy Host");
            String id = createRoom(host, "Baner", "Sunrise Heights");
            String body = liveRoomBody(host, "Baner", "Sunrise Heights", 17500);

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body.replaceFirst("\\{", "{\"occupants\":2,\"maxOccupants\":4,")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.occupants").value(2))
                    .andExpect(jsonPath("$.maxOccupants").value(4));

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.occupants").value(2));
        }

        @Test
        @DisplayName("is refused to anyone but the host")
        void onlyTheHostMayEdit() throws Exception {
            User host = user("9811000104", "Owner Of Room");
            User stranger = user("9811000105", "Passer By");
            String id = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(liveRoomBody(host, "Baner", "Sunrise Heights", 1000)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("resizes a group, but never below the people already in it")
        void aGroupCannotBeResizedBelowItsMembers() throws Exception {
            User host = user("9811000106", "Group Host");
            User joiner = user("9811000126", "Second Member");
            String id = createGroup(host, "Baner 3BHK", "Baner", "any", 3, 2);

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner)))
                    .andExpect(status().isCreated());

            // Seats move here and only here: PATCH .../seats adjusts how many of the existing seats
            // are open. Growing is fine.
            mvc.perform(patch(Routes.Flatmates.GROUP_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(groupBody(host, "Baner 3BHK", "Baner", "any", 4, 2)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.seatsTotal").value(4));

            // Shrinking below the member count is an eviction, and no route means that. 400 rather
            // than 422: the number is well-formed, the group it applies to makes it impossible.
            mvc.perform(patch(Routes.Flatmates.GROUP_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(groupBody(host, "Baner 3BHK", "Baner", "any", 1, 0)))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("is not a conflict just because the host is at their posting cap")
        void anEditByAHostAtTheCapIsNotAConflict() throws Exception {
            User host = user("9811000107", "Busy Host");
            String first = createRoom(host, "Baner", "Alpha Towers");
            createRoom(host, "Kothrud", "Beta Towers");
            createRoom(host, "Wakad", "Gamma Towers");

            // At the cap `evaluate` answers "blocked", and "duplicate" for this address, because it
            // is a duplicate of itself. Copying the create path makes every edit here a 409.
            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, first)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(liveRoomBody(host, "Baner", "Alpha Towers", 16000)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.budget").value(16000));
        }

        @Test
        @DisplayName("leaves an approved post on the board rather than re-queueing it")
        void anApprovedPostStaysOnTheBoardAfterAnEdit() throws Exception {
            User host = user("9811000108", "Declared Host");
            String id = createRoom(host, "Aundh", "Delta Court");

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(liveRoomBody(host, "Aundh", "Delta Court", 15500)))
                    .andExpect(status().isOk());

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "Aundh").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(id)));
        }
    }

    @Nested
    @DisplayName("The seeker's own outbox")
    class Outbox {

        @Test
        @DisplayName("lists what this account asked for, named, across every kind of target")
        void listsInterestsWithTheirTargetNamed() throws Exception {
            User host = user("9811000109", "Room Host");
            User seeker = user("9811000110", "Asker");
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"message":"Call me on 9811000195."}
                                    """))
                    .andExpect(status().isCreated());

            mvc.perform(get(Routes.Flatmates.MY_INTERESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].kind").value("room"))
                    .andExpect(jsonPath("$.content[0].targetId").value(roomId))
                    .andExpect(jsonPath("$.content[0].targetTitle").value("Sunrise Heights"))
                    .andExpect(jsonPath("$.content[0].status").value("pending"));
        }

        @Test
        @DisplayName("shows the caller their own number and never the host's")
        void carriesNoContactBackTowardTheHost() throws Exception {
            User host = user("9811000111", "Private Host");
            User seeker = user("9811000112", "Asker Two");
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            // Contact in this feature is one-directional: the host decides, and accepting is what
            // hands over a number. A read of "what I sent" must not become the back door.
            mvc.perform(get(Routes.Flatmates.MY_INTERESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].requesterMobile").value("9811000112"))
                    .andExpect(jsonPath("$..*", Matchers.not(Matchers.hasItem("9811000111"))));
        }

        @Test
        @DisplayName("does not show one seeker what another sent")
        void isScopedToTheCaller() throws Exception {
            User host = user("9811000113", "Host Three");
            User seeker = user("9811000114", "Asker Three");
            User bystander = user("9811000115", "Nobody");
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            mvc.perform(get(Routes.Flatmates.MY_INTERESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(bystander)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content").isEmpty());
        }
    }

    @Nested
    @DisplayName("The host's notification")
    class HostNotification {

        private String titleFor(User host) {
            List<String> titles = jdbc.queryForList(
                    "select title from notifications where user_id = ? and type = 'flatmate.room.interest'",
                    String.class, host.getId());
            assertThat(titles).as("the host should have been notified exactly once").hasSize(1);
            return titles.getFirst();
        }

        @Test
        @DisplayName("names the seeker when the seeker has a name")
        void namesTheSeeker() throws Exception {
            User host = user("9811000190", "Named Host");
            User seeker = user("9811000191", "Priya Kulkarni");
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            // Asserted positively first: without this, the nameless test below would still pass
            // against a title that had stopped mentioning the seeker at all.
            assertThat(titleFor(host)).isEqualTo("Priya Kulkarni is interested in your room in Baner");
        }

        @Test
        @DisplayName("says 'Someone' rather than the word null when the seeker has no name yet")
        void doesNotRenderAnAbsentNameAsTheWordNull() throws Exception {
            User host = user("9811000192", "Nameless Case Host");
            User seeker = user("9811000193", null);
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            assertThat(titleFor(host)).isEqualTo("Someone is interested in your room in Baner");
        }

        @Test
        @DisplayName("keeps mobile numbers out of notification copy")
        void notificationCopyDoesNotCarryMobileNumbers() throws Exception {
            User host = user("9811000194", "Body Host");
            User seeker = user("9811000195", null);
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            Map<String, Object> notification = jdbc.queryForMap("""
                    select title, body from notifications
                     where user_id = ? and type = 'flatmate.room.interest'
                    """, host.getId());
            assertThat((String) notification.get("title")).doesNotContainPattern("\\b\\d{10}\\b");
            assertThat((String) notification.get("body")).doesNotContainPattern("\\b\\d{10}\\b");
        }
    }

    @Nested
    @DisplayName("Withdrawing an interest")
    class Withdrawal {

        @Test
        @DisplayName("removes the row, and lets the same person ask again afterwards")
        void withdrawalIsAnUndoRatherThanALockout() throws Exception {
            User host = user("9811000116", "Host Four");
            User seeker = user("9811000117", "Asker Four");
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            mvc.perform(delete(Routes.Flatmates.INTEREST_BY_TARGET, "room", roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNoContent());

            mvc.perform(get(Routes.Flatmates.MY_INTERESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content").isEmpty());

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());
        }

        @Test
        @DisplayName("is refused once the host has answered")
        void aDecidedInterestCannotBeWithdrawn() throws Exception {
            User host = user("9811000118", "Host Five");
            User seeker = user("9811000119", "Asker Five");
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            String requestId = jdbc.queryForObject(
                    "select id::text from flatmate_requests where kind = 'room' and target_id = ?::uuid",
                    String.class, roomId);
            mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, requestId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"accepted\"}"))
                    .andExpect(status().isOk());

            // 409 and not 403: the row is the seeker's, it is its state that refuses. The host has
            // acted on it, and on a group they would have given up a seat to do so.
            mvc.perform(delete(Routes.Flatmates.INTEREST_BY_TARGET, "room", roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message",
                            Matchers.containsString(FlatmateConflicts.ALREADY_DECIDED)));
        }

        @Test
        @DisplayName("is a 404 when there was never anything to withdraw")
        void withdrawingSomethingNeverSentIsNotFound() throws Exception {
            User host = user("9811000120", "Host Six");
            User seeker = user("9811000121", "Asker Six");
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(delete(Routes.Flatmates.INTEREST_BY_TARGET, "room", roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("The verified-only facet")
    class VerifiedOnly {

        @Test
        @DisplayName("filters on the server, so it survives past the first page")
        void keepsOnlyVerifiedRooms() throws Exception {
            User badged = user("9811000122", "Badged Host");
            User plain = user("9811000123", "Plain Host");
            String verifiedRoom = createRoom(badged, "Hinjewadi", "Verified Court");
            String plainRoom = createRoom(plain, "Hinjewadi", "Unverified Court");

            // Reaching owner tier honestly needs a property, an owner and an approval, none of
            // which this test is about; the question is only whether the *server* drops the other row.
            jdbc.update("update flatmate_rooms set verification_tier = 'owner' where id = ?::uuid",
                    verifiedRoom);

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in")
                            .param("locality", "Hinjewadi")
                            .param("verifiedOnly", "true")
                            .param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(verifiedRoom)))
                    .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(plainRoom))));
        }

        @Test
        @DisplayName("treats absent and false as the same thing — no filter")
        void offIsNotAFilter() throws Exception {
            User plain = user("9811000124", "Plain Host Two");
            String id = createRoom(plain, "Viman Nagar", "Ordinary Court");

            // A client that always sends the toggle's state should need no special case for off,
            // which is why the parameter is a Boolean and `false` widens rather than narrows.
            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in")
                            .param("locality", "Viman Nagar")
                            .param("verifiedOnly", "false")
                            .param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(id)));
        }
    }
}
