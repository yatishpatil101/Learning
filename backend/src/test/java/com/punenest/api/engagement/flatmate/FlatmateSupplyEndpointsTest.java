package com.punenest.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
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
 * Rooms, groups, the mixed feed and the Ops queue.
 *
 * <p>The centrepiece is {@link Guardrails}: the anti-broker cap and the address dedupe used to live
 * in the browser, reading {@code localStorage}. A cap a client enforces is a suggestion. These tests
 * exist to prove it is now enforced by the process that does the insert, against rows the caller
 * cannot edit.
 *
 * <p>{@link Tiers} covers the other half of the trust model: a verification tier is <em>derived</em>
 * from the caller's real relationship to a listing, never read from the request body.
 */
@DisplayName("Flatmates — rooms, groups, the feed and the guardrails behind them")
class FlatmateSupplyEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        return user(mobile, name, Roles.Wire.BUYER);
    }

    private User user(String mobile, String name, String role) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String roomBody(String locality, String society) {
        return """
                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                 "furnishing":"semi","locality":"%s","society":"%s","rentShare":15000,
                 "deposit":30000,"availableFrom":"2026-09-01","lookingFor":"any",
                 "foodPref":"any","photos":["https://cdn.example/1.jpg"],
                 "note":"Sunny room, quiet building."}
                """.formatted(locality, society);
    }

    private String createRoom(User host, String locality, String society) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(roomBody(locality, society)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return publish("flatmate_rooms", json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));
    }

    /**
     * Let a freshly created row out of the moderation queue (D72).
     *
     * <p>Since D72 a room or group is born {@code pending} and is invisible on every consumer
     * surface until a moderator decides. Nearly every test below is about the <em>feed</em> — how
     * it filters, sorts, prices and paginates — and none of them is about moderation, so they seed
     * published supply on purpose rather than inheriting visibility from a default. That the
     * default is now the other way round is asserted once, deliberately, in
     * {@link FlatmateModerationGateTest}.
     */
    private String publish(String table, String id) {
        jdbc.update("update " + table + " set mod_status = 'approved' where id = ?::uuid", id);
        return id;
    }

    private static String groupBody(String title, String locality) {
        return """
                {"title":"%s","locality":"%s","policy":"women","rent":40000,
                 "seats":3,"seatsOpen":1,"name":"Host","tags":["Vegetarian"]}
                """.formatted(title, locality);
    }

    private String createGroup(User host, String title, String locality) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(groupBody(title, locality)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return publish("flatmate_groups", json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));
    }

    @Nested
    @DisplayName("the anti-broker guardrails (now server-side)")
    class Guardrails {

        @Test
        @DisplayName("a fourth live post from one identity is refused")
        void capIsEnforcedAcrossRoomsAndGroups() throws Exception {
            User host = user("9820000001", "Broker");

            // The cap counts rooms AND groups together — it is a cap on one identity's supply,
            // not on one table.
            createRoom(host, "Baner", "Sai Radha A");
            createRoom(host, "Baner", "Sai Radha B");
            createGroup(host, "Three of us in Baner", "Baner");

            mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(roomBody("Baner", "Sai Radha C")))
                    .andExpect(status().isConflict());
        }

        @Test
        @DisplayName("the same host re-claiming one address is blocked outright")
        void duplicateAddressIsBlocked() throws Exception {
            User host = user("9820000002", "Repeat");
            createRoom(host, "Kothrud", "Green Acres");

            mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(roomBody("Kothrud", "Green Acres")))
                    .andExpect(status().isConflict());
        }

        @Test
        @DisplayName("a DIFFERENT host on the same address is flagged for Ops, not blocked")
        void contestedAddressIsFlaggedNotBlocked() throws Exception {
            User first = user("9820000003", "First");
            User second = user("9820000004", "Second");
            createRoom(first, "Aundh", "Palm Grove");

            // Flag-not-block: the fingerprint is a fuzzy match over free text, and refusing an
            // honest second post is a worse error than asking a human to look.
            String id = createRoom(second, "Aundh", "Palm Grove");

            Boolean flagged = jdbc.queryForObject(
                    "select flag_for_review from flatmate_rooms where id = ?::uuid",
                    Boolean.class, id);
            assertThat(flagged).isTrue();

            Integer queued = jdbc.queryForObject(
                    "select count(*) from flatmate_reviews where room_id = ?::uuid",
                    Integer.class, id);
            assertThat(queued).isOne();
        }

        @Test
        @DisplayName("punctuation and case do not defeat the address match")
        void fingerprintNormalises() throws Exception {
            User host = user("9820000005", "Sneaky");
            createRoom(host, "Wakad", "Sai-Radha Complex");

            mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(roomBody("wakad", "sai radha complex")))
                    .andExpect(status().isConflict());
        }
    }

    @Nested
    @DisplayName("verification tiers")
    class Tiers {

        @Test
        @DisplayName("a client cannot award itself the owner tier by asking for it")
        void tierIsDerivedNotAccepted() throws Exception {
            User host = user("9820000010", "Claimant");

            // role=owner with no property it actually owns: the claim is simply not honoured.
            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Trust me","locality":"Baner","rent":40000,
                                     "name":"Claimant","role":"owner",
                                     "propertyId":"11111111-1111-1111-1111-111111111111"}
                                    """))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.verificationTier").value("identity"))
                    .andReturn().getResponse().getContentAsString();
            assertThat(json).doesNotContain("\"verificationTier\":\"owner\"");
        }

        @Test
        @DisplayName("a declared rent agreement buys a review queue entry, not a badge")
        void tenantClaimIsQueuedNotBadged() throws Exception {
            User host = user("9820000011", "Tenant");

            String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"Rose Villa","rentShare":15000,
                                     "hostRole":"tenant","agreementDeclared":true,
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.verificationTier").value("tenant"))
                    // The claim does NOT grant the pill.
                    .andExpect(jsonPath("$.verified").value(false))
                    .andReturn().getResponse().getContentAsString();

            String id = json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
            Integer queued = jdbc.queryForObject(
                    "select count(*) from flatmate_reviews where room_id = ?::uuid",
                    Integer.class, id);
            assertThat(queued).isOne();
        }
    }

    @Nested
    @DisplayName("seats and occupants")
    class Capacity {

        @Test
        @DisplayName("closing a seat keeps the verification tier — a re-list needs no re-verification")
        void seatChangePreservesTier() throws Exception {
            User host = user("9820000020", "Seater");
            String id = createRoom(host, "Baner", "Blue House");

            mvc.perform(patch(Routes.Flatmates.ROOM_SEATS, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"seatsOpen\":0}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.seatsOpen").value(0))
                    .andExpect(jsonPath("$.verificationTier").value("identity"));
        }

        @Test
        @DisplayName("a seat-model room refuses the occupancy ledger")
        void occupantsRefusedOnSeatRoom() throws Exception {
            User host = user("9820000021", "Seater2");
            String id = createRoom(host, "Baner", "Red House");

            mvc.perform(patch(Routes.Flatmates.ROOM_OCCUPANTS, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"occupants\":2}"))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("changing another host's room is refused")
        void seatsAreHostScoped() throws Exception {
            User host = user("9820000022", "Owner");
            User other = user("9820000023", "Stranger");
            String id = createRoom(host, "Baner", "Yellow House");

            mvc.perform(patch(Routes.Flatmates.ROOM_SEATS, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"seatsOpen\":0}"))
                    .andExpect(status().isForbidden());
        }
    }

    @Nested
    @DisplayName("groups")
    class Groups {

        @Test
        @DisplayName("an open-policy group auto-accepts and takes the seat")
        void openPolicyJoinsOutright() throws Exception {
            User host = user("9820000030", "OpenHost");
            User joiner = user("9820000031", "Joiner");

            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Open house","locality":"Baner","policy":"any",
                                     "rent":40000,"seats":3,"seatsOpen":2,"name":"OpenHost"}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String id = publish("flatmate_groups",
                    json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("accepted"))
                    .andExpect(jsonPath("$.action").value("join"));
        }

        @Test
        @DisplayName("a restricted group files a pending request instead")
        void restrictedPolicyQueues() throws Exception {
            User host = user("9820000032", "PickyHost");
            User joiner = user("9820000033", "Applicant");
            String id = createGroup(host, "Women only in Baner", "Baner");

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("pending"))
                    .andExpect(jsonPath("$.action").value("request"));
        }

        @Test
        @DisplayName("per-head rent is derived from the whole-flat rent, so it cannot drift")
        void perHeadIsDerived() throws Exception {
            User host = user("9820000034", "MathsHost");
            createGroup(host, "Split three ways", "Baner");

            mvc.perform(get(Routes.Flatmates.GROUPS).param("locality", "Baner"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].rent").value(40000))
                    .andExpect(jsonPath("$.content[0].perHead").value(40000 / 3));
        }
    }

    /**
     * D175 — one answer to "I already asked", on both of this service's doors.
     *
     * <p>These are deliberately <em>sequential</em>. The racing version of the same question lives
     * in {@code FlatmateDuplicateInterestRaceTest}, which needs real commits and therefore cannot be
     * on {@code AbstractApiTest}; this suite covers the path nobody was testing, which is a person
     * simply pressing the button again a minute later. That path used to answer 201 while the racing
     * one answered 409 — same action, two contract-visible outcomes, and only one of them declared.
     */
    @Nested
    @DisplayName("asking twice")
    class Duplicates {

        @Test
        @DisplayName("a second room enquiry is refused with 409 and leaves one row")
        void secondRoomInterestIsRefused() throws Exception {
            User host = user("9820000050", "RoomHost");
            User requester = user("9820000051", "Keen");
            String id = createRoom(host, "Baner", "Blue House");

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\",\"message\":\"First ask.\"}"))
                    .andExpect(status().isCreated());

            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\",\"message\":\"Second ask.\"}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.containsString("already")));

            Integer rows = jdbc.queryForObject(
                    "select count(*) from flatmate_requests where kind = 'room' and target_id = ?::uuid",
                    Integer.class, id);
            assertThat(rows).isOne();

            // The refusal is total — the host keeps the pitch they were actually sent.
            String stored = jdbc.queryForObject(
                    "select message from flatmate_requests where target_id = ?::uuid",
                    String.class, id);
            assertThat(stored).isEqualTo("First ask.");
        }

        @Test
        @DisplayName("a second request to a restricted group is refused with 409")
        void secondGroupRequestIsRefused() throws Exception {
            User host = user("9820000052", "PickyHost");
            User joiner = user("9820000053", "Applicant");
            String id = createGroup(host, "Women only in Kothrud", "Kothrud");

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("pending"));

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.containsString("already")));

            Integer rows = jdbc.queryForObject(
                    "select count(*) from flatmate_requests where kind = 'group' and target_id = ?::uuid",
                    Integer.class, id);
            assertThat(rows).isOne();
        }

        @Test
        @DisplayName("a second join of an open group does not take a second seat")
        void secondOpenJoinTakesNothing() throws Exception {
            User host = user("9820000054", "OpenHost");
            User joiner = user("9820000055", "Joiner");

            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Open house in Wakad","locality":"Wakad","policy":"any",
                                     "rent":40000,"seats":3,"seatsOpen":2,"name":"OpenHost"}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String id = publish("flatmate_groups",
                    json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("accepted"));

            // Re-publish, and not to paper over anything: this suite seeds moderation state with a
            // raw JDBC update, which the persistence context it shares with the service never sees.
            // The auto-accept branch of join() saves the group to spend the seat, and that write
            // carries the entity's stale `pending` back to the row. A real approval goes through the
            // moderation API and leaves the loaded entity agreeing with the row, so this is a
            // property of the harness rather than of the endpoint — but without it the second call
            // answers 404 and stops telling us anything about duplicates.
            publish("flatmate_groups", id);

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\"}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.containsString("already")));

            // The seat and the member card are what made this door worse than the other two: the
            // old pre-check returned the existing row as a success, and join() then ran its
            // auto-accept block a second time on the strength of it — a duplicate member and a seat
            // spent on nobody.
            Integer seatsOpen = jdbc.queryForObject(
                    "select seats_open from flatmate_groups where id = ?::uuid", Integer.class, id);
            assertThat(seatsOpen).isOne();

            // Two, and two is the whole claim: the host, who is enrolled as the first member when
            // the group is created, plus the one person who actually joined. The duplicate press
            // added nobody. Asserting one here would be asserting the host had vanished.
            Integer members = jdbc.queryForObject(
                    "select count(*) from flatmate_group_members where group_id = ?::uuid",
                    Integer.class, id);
            assertThat(members).isEqualTo(2);
        }
    }

    @Nested
    @DisplayName("the mixed feed")
    class Feed {

        @Test
        @DisplayName("move-in shows rooms; team-up shows people")
        void tabsSplitByIntentNotByTable() throws Exception {
            User roomHost = user("9820000040", "RoomHost");
            User seeker = user("9820000041", "Seeker");
            createRoom(roomHost, "Hinjewadi", "Tech Park Homes");

            String postJson = mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"Seeker","budget":12000,"localities":["Hinjewadi"]}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            publish("flatmate_seeker_posts",
                    postJson.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));

            mvc.perform(get(Routes.Flatmates.FEED)
                            .param("tab", "move-in").param("locality", "Hinjewadi"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));

            mvc.perform(get(Routes.Flatmates.FEED)
                            .param("tab", "team-up").param("locality", "Hinjewadi"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("the deprecated ?view= alias still resolves to the right tab")
        void legacyViewAliasResolves() throws Exception {
            User host = user("9820000042", "LegacyHost");
            createRoom(host, "Viman Nagar", "Airport View");

            // `rooms` is the old name for move-in. Falling back to the default would show
            // somebody the wrong half of the market and look like a forgotten filter.
            mvc.perform(get(Routes.Flatmates.FEED)
                            .param("view", "rooms").param("locality", "Viman Nagar"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("is public and carries no host contact")
        void feedIsAnonymous() throws Exception {
            User host = user("9820000043", "QuietHost");
            createRoom(host, "Kalyani Nagar", "River Side");

            mvc.perform(get(Routes.Flatmates.FEED).param("locality", "Kalyani Nagar"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].ownerMobile").doesNotExist());
        }
    }

    @Nested
    @DisplayName("the Ops queue")
    class OpsQueue {

        @Test
        @DisplayName("approving grants the badge and tells the host")
        void approvingGrantsTheBadge() throws Exception {
            User host = user("9820000050", "Claimer");
            User ops = user("9820000051", "Ops", Roles.Wire.STAFF);

            String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"Verified Villa","rentShare":15000,
                                     "hostRole":"tenant","agreementDeclared":true,
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String roomId = json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

            String reviewId = jdbc.queryForObject(
                    "select id::text from flatmate_reviews where room_id = ?::uuid",
                    String.class, roomId);

            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, reviewId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("approved"));

            Boolean verified = jdbc.queryForObject(
                    "select verified from flatmate_rooms where id = ?::uuid", Boolean.class, roomId);
            assertThat(verified).isTrue();
        }

        @Test
        @DisplayName("a rejection without a reason is refused")
        void rejectionNeedsAReason() throws Exception {
            User host = user("9820000052", "Claimer2");
            User ops = user("9820000053", "Ops2", Roles.Wire.STAFF);

            String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"Doubtful Heights","rentShare":15000,
                                     "hostRole":"tenant","agreementDeclared":true,
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String roomId = json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
            String reviewId = jdbc.queryForObject(
                    "select id::text from flatmate_reviews where room_id = ?::uuid",
                    String.class, roomId);

            // A host told "no" with no reason cannot fix anything.
            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, reviewId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"rejected\"}"))
                    .andExpect(status().isBadRequest());
        }

        @Test
        @DisplayName("the queue is staff-only")
        void queueIsStaffOnly() throws Exception {
            User consumer = user("9820000054", "Nosy");

            mvc.perform(get(Routes.Moderation.FLATMATE_REVIEWS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(consumer)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("flagging a room removes it from the feed rather than relabelling it")
        void moderationHidesFromEveryConsumerSurface() throws Exception {
            User host = user("9820000055", "Flagged");
            User admin = user("9820000056", "Admin", Roles.Wire.ADMIN);
            String roomId = createRoom(host, "Magarpatta", "City Towers");

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"removed\",\"note\":\"broker\"}"))
                    .andExpect(status().isOk());

            mvc.perform(get(Routes.Flatmates.FEED).param("locality", "Magarpatta"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));

            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Magarpatta"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }
    }

    /**
     * D116 — the room and group feeds filter on every facet the page offers, server-side, rather
     * than answering 200 with an unfiltered list. Each test isolates its data behind a unique
     * locality and asserts an exact page size, because "the filter narrowed something" is a weaker
     * claim than "the filter returned exactly these". Three rooms or groups per host is the
     * anti-broker cap's ceiling; a fourth would be the wrong test refused for the wrong reason.
     */
    @Nested
    @DisplayName("server-side facets (D116)")
    class Facets {

        private String facetRoomBody(String locality, String society, String lookingFor,
                String foodPref, long rentShare, String bhk) {
            return """
                    {"bhk":"%s","roomType":"Private room","attachedBath":"attached",
                     "furnishing":"semi","locality":"%s","society":"%s","rentShare":%d,
                     "deposit":30000,"availableFrom":"2026-09-01","lookingFor":"%s",
                     "foodPref":"%s","photos":["https://cdn.example/1.jpg"],"note":"Room."}
                    """.formatted(bhk, locality, society, rentShare, lookingFor, foodPref);
        }

        private void createFacetRoom(User host, String locality, String society, String lookingFor,
                String foodPref, long rentShare, String bhk) throws Exception {
            String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(facetRoomBody(
                                    locality, society, lookingFor, foodPref, rentShare, bhk)))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            publish("flatmate_rooms", json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));
        }

        private String facetGroupBody(String title, String locality, String policy, long rent) {
            return """
                    {"title":"%s","locality":"%s","policy":"%s","rent":%d,
                     "seats":3,"seatsOpen":1,"name":"Host"}
                    """.formatted(title, locality, policy, rent);
        }

        private void createFacetGroup(User host, String title, String locality, String policy,
                long rent) throws Exception {
            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(facetGroupBody(title, locality, policy, rent)))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            publish("flatmate_groups", json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1"));
        }

        @Test
        @DisplayName("gender filters server-side, and an 'any' room matches every request")
        void genderFacetWithAnyFallback() throws Exception {
            User host = user("9820000060", "GenderHost");
            createFacetRoom(host, "GenderFacetTown", "A", "female", "any", 15000, "2");
            createFacetRoom(host, "GenderFacetTown", "B", "any", "any", 15000, "2");
            createFacetRoom(host, "GenderFacetTown", "C", "male", "any", 15000, "2");

            // A female request returns the female room and the no-preference room — never the male.
            mvc.perform(get(Routes.Flatmates.ROOMS)
                            .param("locality", "GenderFacetTown").param("gender", "female"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(2)));

            // A request of 'any' states no preference: it must not exclude a thing.
            mvc.perform(get(Routes.Flatmates.ROOMS)
                            .param("locality", "GenderFacetTown").param("gender", "any"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(3)));
        }

        @Test
        @DisplayName("budget range filters rooms server-side")
        void roomBudgetRange() throws Exception {
            User host = user("9820000061", "BudgetHost");
            createFacetRoom(host, "BudgetFacetTown", "Cheap", "any", "any", 10000, "2");
            createFacetRoom(host, "BudgetFacetTown", "Mid", "any", "any", 20000, "2");
            createFacetRoom(host, "BudgetFacetTown", "Pricey", "any", "any", 30000, "2");

            mvc.perform(get(Routes.Flatmates.ROOMS)
                            .param("locality", "BudgetFacetTown")
                            .param("minBudget", "15000").param("maxBudget", "25000"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("BHK is an exact server-side filter")
        void bhkExactFacet() throws Exception {
            User host = user("9820000062", "BhkHost");
            createFacetRoom(host, "BhkFacetTown", "Two", "any", "any", 15000, "2");
            createFacetRoom(host, "BhkFacetTown", "Three", "any", "any", 15000, "3");

            mvc.perform(get(Routes.Flatmates.ROOMS)
                            .param("locality", "BhkFacetTown").param("bhk", "3"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("policy filters groups server-side, and an open group matches every request")
        void policyFacetWithAnyFallback() throws Exception {
            User host = user("9820000070", "PolicyHost");
            createFacetGroup(host, "Women grp", "PolicyFacetTown", "women", 40000);
            createFacetGroup(host, "Open grp", "PolicyFacetTown", "any", 40000);
            createFacetGroup(host, "Men grp", "PolicyFacetTown", "men", 40000);

            // A women request returns the women group and the open group — never the men-only one.
            mvc.perform(get(Routes.Flatmates.GROUPS)
                            .param("locality", "PolicyFacetTown").param("policy", "women"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(2)));
        }

        @Test
        @DisplayName("rent range filters groups server-side")
        void groupRentRange() throws Exception {
            User host = user("9820000071", "RentHost");
            createFacetGroup(host, "Cheap", "RentFacetTown", "any", 20000);
            createFacetGroup(host, "Mid", "RentFacetTown", "any", 40000);
            createFacetGroup(host, "Pricey", "RentFacetTown", "any", 60000);

            mvc.perform(get(Routes.Flatmates.GROUPS)
                            .param("locality", "RentFacetTown")
                            .param("minRent", "30000").param("maxRent", "50000"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));
        }
    }
}
