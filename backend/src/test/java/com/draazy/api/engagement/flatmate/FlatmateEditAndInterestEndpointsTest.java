package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * The four things a flatmate host or seeker could not do before, and the rule that put their posts
 * on the board without waiting for Ops.
 *
 * <p>Four routes and one behaviour change, tested together because they are one wave and they share
 * their traps:
 *
 * <ol>
 *   <li><strong>Auto-publish.</strong> Every post used to be written {@code pending} and nothing
 *       ever published one, so the board filled only at the speed Ops clicked. The tier ladder now
 *       decides.</li>
 *   <li><strong>Editing.</strong> {@code PATCH} on a room and a group, so fixing a typo stops
 *       meaning delete-and-repost — which cost the host every reply they had already received,
 *       because the interest rows pointed at the dead id.</li>
 *   <li><strong>The seeker's outbox.</strong> What this account has asked for, read from the table
 *       that holds it instead of from {@code localStorage}.</li>
 *   <li><strong>Withdrawal.</strong> An interest that can be taken back while it is still
 *       unanswered.</li>
 * </ol>
 *
 * <p>The assertions worth reading twice are {@link Editing#anEditByAHostAtTheCapIsNotAConflict} and
 * {@link Editing#anOwnerTierEditStaysOnTheBoard}. Both pin decisions that the obvious
 * implementation gets wrong, and both would pass silently in the wrong direction — the first as a
 * 409 nobody can explain, the second as a queue that refills itself.
 */
@DisplayName("Flatmates — publishing, editing, and taking an interest back")
class FlatmateEditAndInterestEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

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
                 "note":"Sunny room, quiet building."}
                """.formatted(locality, society, rentShare);
    }

    /**
     * A room that is actually on the board.
     *
     * <p>Declaring an agreement is what makes this tenant tier, and tenant tier is what publishes.
     * Almost every test below needs that, because a pending room is invisible and
     * {@code POST .../interest} answers {@code 404} for it — correctly, and confusingly, since the
     * host can still see it perfectly well in their own dashboard.
     */
    private static String liveRoomBody(String locality, String society, long rentShare) {
        return roomBody(locality, society, rentShare)
                .replace("\"bhk\"", "\"agreementDeclared\":true,\"bhk\"");
    }

    private static String groupBody(String title, String locality, String policy,
            int seats, int seatsOpen) {
        // `agreement` is what makes this tenant tier, and tenant tier is what publishes. An
        // unpublished group cannot be joined: `findVisible` answers 404 for it.
        return """
                {"title":"%s","locality":"%s","policy":"%s","rent":40000,"agreement":true,
                 "seats":%d,"seatsOpen":%d,"name":"Host","tags":["Vegetarian"]}
                """.formatted(title, locality, policy, seats, seatsOpen);
    }

    private static String idOf(String json) {
        return json.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String createRoom(User host, String locality, String society) throws Exception {
        return idOf(mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(liveRoomBody(locality, society, 15000)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private String createGroup(User host, String title, String locality) throws Exception {
        return createGroup(host, title, locality, "women", 3, 1);
    }

    private String createGroup(User host, String title, String locality, String policy,
            int seats, int seatsOpen) throws Exception {
        return idOf(mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(groupBody(title, locality, policy, seats, seatsOpen)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    @Nested
    @DisplayName("A newly written post")
    class Publishing {

        @Test
        @DisplayName("reaches the board without an Ops click when the host declared an agreement")
        void aTenantTierPostPublishesItself() throws Exception {
            User host = user("9811000101", "Tenant Host");
            String id = createRoom(host, "Baner", "Sunrise Heights");

            // The anonymous feed is the test that matters: a host can always see their own post,
            // so asserting on the host's view would have passed throughout the months this was
            // broken. What was broken is that nobody else could see it.
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Baner").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(id)));
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

            // Signed in and nothing more is exactly the population the gate is for, and it is the
            // cheapest identity for a broker to mint. This is the half of the ladder that still
            // holds, and it has to keep holding or auto-publish is just "publish".
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Kothrud").param("size", "100"))
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
                            .content(liveRoomBody("Baner", "Sunrise Heights", 17500)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.id").value(id))
                    // `budget` on the wire out, `rentShare` on the wire in. The asking price for
                    // the seat has two names and the entity column is the read one.
                    .andExpect(jsonPath("$.budget").value(17500));
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
                            .content(liveRoomBody("Baner", "Sunrise Heights", 1000)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("resizes a group, but never below the people already in it")
        void aGroupCannotBeResizedBelowItsMembers() throws Exception {
            User host = user("9811000106", "Group Host");
            User joiner = user("9811000126", "Second Member");
            String id = createGroup(host, "Baner 3BHK", "Baner", "any", 3, 2);

            // An open group auto-accepts, so this is the shortest honest way to a two-member group.
            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner)))
                    .andExpect(status().isCreated());

            // Seats move here and only here: PATCH .../seats adjusts how many of the existing seats
            // are open. Growing is fine.
            mvc.perform(patch(Routes.Flatmates.GROUP_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(groupBody("Baner 3BHK", "Baner", "any", 4, 2)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.seatsTotal").value(4));

            // Shrinking below the member count is not an edit, it is an eviction, and no route
            // means that. 400 rather than 422 because the number is well-formed; it is the group
            // it would be applied to that makes it impossible.
            mvc.perform(patch(Routes.Flatmates.GROUP_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(groupBody("Baner 3BHK", "Baner", "any", 1, 0)))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("is not a conflict just because the host is at their posting cap")
        void anEditByAHostAtTheCapIsNotAConflict() throws Exception {
            User host = user("9811000107", "Busy Host");
            String first = createRoom(host, "Baner", "Alpha Towers");
            createRoom(host, "Kothrud", "Beta Towers");
            createRoom(host, "Wakad", "Gamma Towers");

            // Three live posts is the cap, so `evaluate` now answers "blocked" for this host —
            // and it answers "duplicate" for this address, because the address is a duplicate of
            // itself. Honouring either on an edit, which is what copying the create path gives
            // you, makes every edit by a productive host a 409 nobody can explain.
            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, first)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(liveRoomBody("Baner", "Alpha Towers", 16000)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.budget").value(16000));
        }

        @Test
        @DisplayName("leaves an already-published post on the board rather than re-queueing it")
        void anOwnerTierEditStaysOnTheBoard() throws Exception {
            User host = user("9811000108", "Declared Host");
            String id = createRoom(host, "Aundh", "Delta Court");

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(liveRoomBody("Aundh", "Delta Court", 15500)))
                    .andExpect(status().isOk());

            // The rule is "an edit sends the post back for review", and it does — for the tier
            // whose visibility a human granted. This post's visibility came from what the host
            // staked, not from a moderator reading the copy, so there is no approval for the edit
            // to invalidate. Sending it back would rebuild the queue auto-publish exists to drain.
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Aundh").param("size", "100"))
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
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            // The title is the assertion. The join this read shares with the host inbox resolved
            // seeker posts only, so a room row arrived with a null title and rendered as "this is
            // gone" — invisible on the inbox, where rooms are rare, and unmissable here.
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

    /**
     * What the host is actually told when the interest lands.
     *
     * <p>The outbox tests above read the seeker's own copy. This reads the other end — the row in
     * {@code notifications} the host opens — because the two are composed by different code and
     * only one of them had ever been asserted.
     *
     * <p><strong>Why the nameless case gets its own test.</strong> {@code users.name} is nullable
     * and is most often null for precisely the person who ends up here: someone who signed in by
     * OTP to answer an ad and has not filled in a profile (D118). The title was built by
     * concatenating that field, so Java rendered the absent name as the four letters {@code null}
     * and the host was told "null is interested in Sunrise Heights". A test that only ever seeds
     * named users — which is every other test in this file — passes straight through that.
     */
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
            // against a title that had stopped mentioning the seeker at all. The target half is
            // the host's own phrasing of the room ("your room in <locality>") rather than the
            // society name — the host is being told about their own listing.
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

            // "Someone" is indefinite on purpose. The alternative the schema used to force was a
            // made-up name shown to the host as this person's, and absent is not the same claim as
            // "called Member". The target still has to be named, or the host cannot tell which of
            // their rooms this is about.
            assertThat(titleFor(host)).isEqualTo("Someone is interested in your room in Baner");
        }

        @Test
        @DisplayName("carries the seeker's number in the body, which is never absent")
        void theBodyCarriesTheNumber() throws Exception {
            User host = user("9811000194", "Body Host");
            User seeker = user("9811000195", null);
            String roomId = createRoom(host, "Baner", "Sunrise Heights");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker)))
                    .andExpect(status().isCreated());

            // The reason "Someone" is a tolerable title rather than a dead end: `users.mobile` is
            // the login identity and NOT NULL, so an unnamed seeker is still reachable.
            String body = jdbc.queryForObject(
                    "select body from notifications where user_id = ? and type = 'flatmate.room.interest'",
                    String.class, host.getId());
            assertThat(body).contains("9811000195");
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

            // The reason the row is deleted rather than flagged withdrawn: the table is unique on
            // (kind, target_id, requester_id), so a retained row would refuse the next ask forever
            // and turn an undo into a lockout. This is that invariant, stated as behaviour.
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

            // The badge is set by the create path only for owner tier, and by Ops afterwards for
            // everyone else -- FlatmateModerationService.applyBadge. Neither is what this test is
            // about, so it puts the badge on directly and asks the one question it came to ask:
            // does the *server* drop the other row.
            jdbc.update("update flatmate_rooms set verified = true where id = ?::uuid", verifiedRoom);

            // The board filtered a single 200-row page in the browser, which is correct until a
            // locality has 201 rooms and then silently wrong.
            mvc.perform(get(Routes.Flatmates.ROOMS)
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
            mvc.perform(get(Routes.Flatmates.ROOMS)
                            .param("locality", "Viman Nagar")
                            .param("verifiedOnly", "false")
                            .param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(id)));
        }
    }
}
