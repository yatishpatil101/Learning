package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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
import org.springframework.test.web.servlet.ResultActions;

// A cap a client enforces is a suggestion, so Guardrails proves the anti-broker cap and the address
// dedupe hold in the process that inserts, and Tiers that a tier is derived.
@DisplayName("Flatmates — rooms, groups, the feed and the guardrails behind them")
class FlatmateSupplyEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

        @PersistenceContext
        EntityManager entityManager;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
                createdActors.forEach(actor -> {
                        jdbc.update("delete from audit_log where actor = ?", actor);
                        jdbc.update("delete from flatmate_owner_consents where granted_by = ?::uuid", actor);
                });
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
        return publish("flatmate_rooms", idOf(json));
    }

    // A regex rather than a parse: every caller wants one field out of a body it is already
    // asserting against by jsonPath, and `id` is the first key all these DTOs serialise.
    private static String idOf(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    /** A rent listing owned by {@code owner}, approved or not. */
    private Property listing(User owner, String status) {
        Property p = new Property(owner, "Flat in Baner", "rent", "apartment",
                45000L, "Baner", "Pune");
        p.setBhk(BigDecimal.valueOf(2));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    // A room or group is born pending and invisible; none of the tests below is about moderation,
    // so they seed published supply. The default is pinned in FlatmateModerationGateTest.
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
        return publish("flatmate_groups", idOf(json));
    }

    // The address is the consent's scope (V30), so it must be the one the post will fingerprint at
    // — a group names its flat by title, a room by society — or the post is filed without the flag.
    private String recordOwnerConsent(User host, String title, String society, String locality)
            throws Exception {
        String ownerMobile = "983" + host.getMobile().substring(3);
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ownerMobile":"%s","title":%s,"society":%s,"locality":"%s"}
                                """.formatted(ownerMobile, quoted(title), quoted(society),
                                locality)))
                .andExpect(status().isOk());
        entityManager.flush();
        jdbc.update("""
                        update otp_codes set code_hash = ?
                        where id = (select id from otp_codes where mobile = ?
                                        order by created_at desc limit 1)""",
                sha256Hex("424242"), ownerMobile);
        entityManager.clear();
        mvc.perform(post(Routes.Flatmates.OWNER_CONSENT)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ownerMobile":"%s","otp":"424242",
                                 "title":%s,"society":%s,"locality":"%s"}
                                """.formatted(ownerMobile, quoted(title), quoted(society),
                                locality)))
                .andExpect(status().isOk());
        return ownerMobile;
    }

    /** A JSON string literal, or the {@code null} literal — absent means "this form has no such
     * field", which is a different thing from an empty one. */
    private static String quoted(String value) {
        return value == null ? "null" : "\"" + value + "\"";
    }

    private static String sha256Hex(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(raw.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hex.append(Character.forDigit((value >> 4) & 0xF, 16));
                hex.append(Character.forDigit(value & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
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

        private String ownerRoom(User host, String society, String propertyId) throws Exception {
            return mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"%s","rentShare":15000,"hostRole":"owner",
                                     "propertyId":"%s",
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """.formatted(society, propertyId)))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
        }

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
                                     "photos":["https://cdn.example/1.jpg"],%s}
                                    """.formatted(FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.verificationTier").value("tenant"))
                    // The claim does NOT grant the pill.
                    .andExpect(jsonPath("$.verified").value(false))
                    .andReturn().getResponse().getContentAsString();

            String id = idOf(json);
            Integer queued = jdbc.queryForObject(
                    "select count(*) from flatmate_reviews where room_id = ?::uuid",
                    Integer.class, id);
            assertThat(queued).isOne();
        }

        // Every other fixture sends the full evidence set, so without this nothing would notice the
        // rule loosening back to the bare flag — which is free, and mints tenant tier for anyone.
        @Test
        @DisplayName("a rent agreement claimed without its paperwork buys nothing")
        void anUnevidencedClaimStaysAtIdentityTier() throws Exception {
            User host = user("9820000018", "Claimer");

            String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"Bare Claim House","rentShare":15000,
                                     "hostRole":"tenant","agreementDeclared":true,
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.verificationTier").value("identity"))
                    .andExpect(jsonPath("$.modStatus").value("pending"))
                    .andReturn().getResponse().getContentAsString();

            Integer queued = jdbc.queryForObject(
                    "select count(*) from flatmate_reviews where room_id = ?::uuid",
                    Integer.class, idOf(json));
            assertThat(queued).isZero();
        }

        @Test
        @DisplayName("a spare room in a flat the host demonstrably owns is born owner-tier")
        void ownerTierIsReachableForASpareRoom() throws Exception {
            User host = user("9820000012", "Landlord", Roles.Wire.OWNER);
            Property flat = listing(host, PropertyStatus.APPROVED);

            // Without a propertyId on the room create path this host could only reach identity,
            // which is pending — a queue their own approved listing had already cleared.
            String json = ownerRoom(host, "Landlord Heights", flat.getId().toString());

            assertThat(json).contains("\"verificationTier\":\"owner\"");
            assertThat(json).contains("\"verified\":true");
            // Owner tier skips the queue: reviewing the parent listing's documents twice costs Ops
            // real time for nothing.
            assertThat(json).contains("\"modStatus\":\"live\"");

            String id = idOf(json);
            assertThat(jdbc.queryForObject(
                    "select count(*) from flatmate_reviews where room_id = ?::uuid",
                    Integer.class, id)).isZero();
            // Read for the tier and the fingerprint, never stored: a seat-based room cannot also
            // be a split of a flat (ck_flatmate_rooms_split_has_no_seats).
            assertThat(jdbc.queryForObject(
                    "select property_id from flatmate_rooms where id = ?::uuid", String.class, id))
                    .isNull();
        }

        @Test
        @DisplayName("a room quoting a listing the caller does not own earns nothing")
        void roomPropertyIdIsCheckedNotTrusted() throws Exception {
            User stranger = user("9820000013", "Passer-by", Roles.Wire.OWNER);
            User landlord = user("9820000014", "Real Landlord", Roles.Wire.OWNER);
            Property notTheirs = listing(landlord, PropertyStatus.APPROVED);

            String json = ownerRoom(stranger, "Someone Elses Place",
                    notTheirs.getId().toString());

            assertThat(json).contains("\"verificationTier\":\"identity\"");
            assertThat(json).contains("\"verified\":false");
        }

        @Test
        @DisplayName("an edit can claim the flat the create forgot to")
        void updateHonoursPropertyIdToo() throws Exception {
            User host = user("9820000015", "Late Claimer", Roles.Wire.OWNER);
            Property flat = listing(host, PropertyStatus.APPROVED);
            String id = createRoom(host, "Baner", "Afterthought Court");

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"Afterthought Court","rentShare":15000,
                                     "hostRole":"owner","propertyId":"%s",
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """.formatted(flat.getId())))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.verificationTier").value("owner"))
                    .andExpect(jsonPath("$.verified").value(true));
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
            String id = publish("flatmate_groups", idOf(json));

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

        // users.name is nullable (an OTP sign-in gives a mobile and nothing else), and a fabricated
        // name would be shown to other people as theirs — so initials must stay null too.
        @Test
        @DisplayName("a joiner who has never given a name joins with no name, not with \"Member\"")
        void namelessJoinerStoresNoName() throws Exception {
            User host = user("9820000035", "OpenHost2");
            User joiner = user("9820000036", null);

            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Nameless welcome","locality":"Kothrud","policy":"any",
                                     "rent":30000,"seats":3,"seatsOpen":2,"name":"OpenHost2"}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String id = publish("flatmate_groups", idOf(json));

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("accepted"));

            assertThat(jdbc.queryForObject(
                    "select count(*) from flatmate_group_members "
                            + "where group_id = ?::uuid and user_id = ?::uuid "
                            + "and name is null and initials is null",
                    Integer.class, id, joiner.getId().toString()))
                    .as("the nameless joiner's row stores no name and no derived initials")
                    .isEqualTo(1);

            // Re-publish for the harness reason `secondOpenJoinTakesNothing` spells out: the join
            // flushes the stale `pending` back over the JDBC update above.
            publish("flatmate_groups", id);

            mvc.perform(get(Routes.Flatmates.GROUPS).param("locality", "Kothrud"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].members.length()").value(2))
                    // Collected across both members rather than indexed: the feed fetch-joins the
                    // collection under its own `order by`, so member order is not guaranteed.
                    .andExpect(jsonPath("$.content[0].members[*].name",
                            Matchers.hasItem(Matchers.nullValue())))
                    .andExpect(jsonPath("$.content[0].members[*].name",
                            Matchers.hasItem("OpenHost2")))
                    .andExpect(jsonPath("$.content[0].members[*].name",
                            Matchers.not(Matchers.hasItem("Member"))))
                    .andExpect(jsonPath("$.content[0].members[*].initials",
                            Matchers.hasItem(Matchers.nullValue())));
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

        // The client can only tell group_full from already_interested by the trailing marker, and
        // the marker only reaches it if nothing follows — so the position is what is asserted.
        @Test
        @DisplayName("joining a group whose last seat has gone is group_full, not already_interested")
        void fullGroupRefusesWithItsOwnSubCode() throws Exception {
            User host = user("9820000056", "FullHost");
            User joiner = user("9820000057", "TooLate");
            String id = createGroup(host, "One seat in Kothrud", "Kothrud");

            mvc.perform(patch(Routes.Flatmates.GROUP_SEATS, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"seatsOpen\":0}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.seatsOpen").value(0));

            // Re-publish for the harness reason `secondOpenJoinTakesNothing` spells out: the seats
            // save above writes the entity's stale `pending` back over the row.
            publish("flatmate_groups", id);

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.endsWith("(group_full)")))
                    // Both refusals travel as `error: "conflict"`, so the sub-code is the only
                    // thing separating a red refusal from a benign notice.
                    .andExpect(jsonPath("$.message",
                            Matchers.not(Matchers.containsString("already_interested"))));

            // Refused, not queued: a pending request against a full group would have the host
            // deciding on a seat that does not exist.
            Integer rows = jdbc.queryForObject(
                    "select count(*) from flatmate_requests where kind = 'group' and target_id = ?::uuid",
                    Integer.class, id);
            assertThat(rows).isZero();
        }
    }

    // Deliberately sequential; the racing version lives in FlatmateDuplicateInterestRaceTest, which
    // needs real commits. Answering 201 here while that one answers 409 would be two contracts.
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
                    // Ends with, not contains — see FlatmateConflicts for why the position is the
                    // contract and not just the presence.
                    .andExpect(jsonPath("$.message", Matchers.endsWith("(already_interested)")));

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
                    .andExpect(jsonPath("$.message", Matchers.endsWith("(already_interested)")));

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
            String id = publish("flatmate_groups", idOf(json));

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.status").value("accepted"));

            // Re-publish: this suite seeds moderation state with a raw JDBC update the shared
            // persistence context never sees, and join()'s auto-accept save carries `pending` back.
            publish("flatmate_groups", id);

            mvc.perform(post(Routes.Flatmates.GROUP_JOIN, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(joiner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\"}"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.message", Matchers.endsWith("(already_interested)")));

            // A pre-check returning the existing row as a success would have join() run its
            // auto-accept block again: a duplicate member and a seat spent on nobody.
            Integer seatsOpen = jdbc.queryForObject(
                    "select seats_open from flatmate_groups where id = ?::uuid", Integer.class, id);
            assertThat(seatsOpen).isOne();

            // Two: the host, enrolled as the first member at create time, plus the one joiner.
            // Asserting one here would be asserting the host had vanished.
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
            publish("flatmate_seeker_posts", idOf(postJson));

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

        /** Post a room whose host claims a rent agreement, so a review is queued behind it. */
        private String tenantClaimRoom(User host, String society) throws Exception {
            return tenantClaimRoom(host, society, null);
        }

        private String tenantClaimRoom(User host, String society, String ownerConsentMobile)
                throws Exception {
            String consent = ownerConsentMobile == null ? ""
                    : ",\"ownerConsentMobile\":\"%s\"".formatted(ownerConsentMobile);
            String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"%s","rentShare":15000,
                                     "hostRole":"tenant","agreementDeclared":true,%s,
                                     "photos":["https://cdn.example/1.jpg"]%s}
                                    """.formatted(society, FlatmateAgreementFixture.EVIDENCE, consent)))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            return idOf(json);
        }

        private String consentedTenantClaimRoom(User host, String society) throws Exception {
            return tenantClaimRoom(host, society,
                    recordOwnerConsent(host, null, society, "Baner"));
        }

        private String roomReview(String roomId) {
            return jdbc.queryForObject(
                    "select id::text from flatmate_reviews where room_id = ?::uuid",
                    String.class, roomId);
        }

        private String roomTier(String roomId) {
            return jdbc.queryForObject(
                    "select verification_tier from flatmate_rooms where id = ?::uuid",
                    String.class, roomId);
        }

        private ResultActions reconcile(User ops) throws Exception {
            return mvc.perform(post(Routes.Moderation.FLATMATE_OWNER_TIER_RECONCILE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops)))
                    .andExpect(status().isOk());
        }

        @Test
        @DisplayName("approving grants the badge and tells the host")
        void approvingGrantsTheBadge() throws Exception {
            User host = user("9820000050", "Claimer");
            User ops = user("9820000051", "Ops", Roles.Wire.STAFF);
            String unconsentedRoomId = tenantClaimRoom(host, "Unconsented Villa");

            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, roomReview(unconsentedRoomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().is(422));

            String roomId = consentedTenantClaimRoom(host, "Verified Villa");
            String reviewId = roomReview(roomId);

            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, reviewId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("approved"));

            // One queue, one badge. Landing the verdict on `verified` for a room and on the tier
            // for a group would make the same click on the same screen write two different facts.
            assertThat(roomTier(roomId)).isEqualTo("tenant");

            // And the card agrees: the badge is derived from tier plus verdict, so an approved
            // claim cannot pass the Verified-only filter while its own card comes back unbadged.
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Baner")
                            .param("verifiedOnly", "true").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(roomId)))
                    .andExpect(jsonPath("$.content[?(@.id == '" + roomId + "')].verified",
                            Matchers.hasItem(true)));
            // And so does the host's own write response: one built without the verdict would tell
            // a host who merely reopened a seat that the claim Ops just accepted had lapsed.
            mvc.perform(patch(Routes.Flatmates.ROOM_SEATS, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"seatsOpen\":0}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.verified").value(true))
                    .andExpect(jsonPath("$.reviewStatus").value("approved"));
        }

        @Test
        @DisplayName("a tenant badge needs every registration field as well as OTP consent")
        void approvingRequiresCompleteAgreementRegistration() throws Exception {
            User ops = user("9820000081", "Ops registration", Roles.Wire.STAFF);

            List<String> columns = List.of("agreement_reg_no", "agreement_registered_on",
                    "agreement_valid_till");
            for (int index = 0; index < columns.size(); index++) {
                String column = columns.get(index);
                User host = user("982000009" + index, "Incomplete registration " + index);
                String roomId = consentedTenantClaimRoom(host, "Missing " + column);
                jdbc.update("update flatmate_reviews set " + column + " = null where room_id = ?::uuid",
                        roomId);
                entityManager.clear();

                mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, roomReview(roomId))
                                .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"decision\":\"approved\"}"))
                        .andExpect(status().is(422));
            }
        }

        @Test
        @DisplayName("the host's next edit sends the badge back to the queue with the claim")
        void editingRevokesTheBadgeItReopens() throws Exception {
            User host = user("9820000057", "Editor");
            User ops = user("9820000058", "Ops6", Roles.Wire.STAFF);
            String roomId = consentedTenantClaimRoom(host, "Second Thoughts");

            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, roomReview(roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().isOk());

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"Somewhere Else Entirely","rentShare":15000,
                                     "hostRole":"tenant","agreementDeclared":true,
                                     "photos":["https://cdn.example/1.jpg"],%s}
                                    """.formatted(FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isOk());

            assertThat(jdbc.queryForObject(
                    "select status from flatmate_reviews where room_id = ?::uuid",
                    String.class, roomId)).isEqualTo("pending");

            // The badge and the verdict are the same fact. Were they two, an edit would re-open
            // the review and leave the row passing this filter with its card badge already gone.
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Baner")
                            .param("verifiedOnly", "true").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(roomId))));
        }

        @Test
        @DisplayName("clearing somebody else's address claim badges nobody")
        void contestedAddressIsNotAnAgreement() throws Exception {
            User first = user("9820000059", "Prior");
            User second = user("9820000060", "Contested");
            User ops = user("9820000061", "Ops7", Roles.Wire.STAFF);
            createRoom(first, "Undri", "Twice Claimed");
            String roomId = createRoom(second, "Undri", "Twice Claimed");

            assertThat(roomTier(roomId)).isEqualTo("identity");

            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, roomReview(roomId))
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().isOk());

            // This host submitted no paperwork: they are queued because a *different* host claimed
            // the same address, which must not mint a badge out of somebody else's mistake.
            assertThat(roomTier(roomId)).isEqualTo("identity");
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Undri")
                            .param("verifiedOnly", "true").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(roomId))));
        }

        @Test
        @DisplayName("an owner upgrade outranks the queue row it left behind")
        void ownerTierSurvivesAStaleVerdict() throws Exception {
            User host = user("9820000062", "Upgrader", Roles.Wire.OWNER);
            User ops = user("9820000063", "Ops8", Roles.Wire.STAFF);
            String roomId = tenantClaimRoom(host, "Deed In Hand");
            String reviewId = roomReview(roomId);

            Property flat = listing(host, PropertyStatus.APPROVED);

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"Deed In Hand","rentShare":15000,
                                     "hostRole":"owner","propertyId":"%s",
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """.formatted(flat.getId())))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.verificationTier").value("owner"));

            // Owner tier skips the queue, which also means it does not close the row the tenant
            // claim opened: that row is still pending and still says `tenant`.
            assertThat(jdbc.queryForObject(
                    "select status from flatmate_reviews where id = ?::uuid",
                    String.class, reviewId)).isEqualTo("pending");

            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, reviewId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"rejected\",\"note\":\"Illegible scan\"}"))
                    .andExpect(status().isOk());

            // Ops answering a question about a rent agreement cannot revoke a tier that came from
            // a title deed, on evidence the host has since stopped offering.
            assertThat(roomTier(roomId)).isEqualTo("owner");
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Baner")
                            .param("verifiedOnly", "true").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.hasItem(roomId)));
        }

        @Test
        @DisplayName("a consent taken for one flat does not vouch for another")
        void consentIsScopedToTheFlatItNamed() throws Exception {
            User host = user("9820000070", "Mover");
            User ops = user("9820000071", "Ops10", Roles.Wire.STAFF);
            String ownerMobile = recordOwnerConsent(host, null, "Consented Villa", "Baner");

            // The thing the scope exists to stop: one owner's OTP, then a post about a flat that
            // owner has never heard of — the badge would say an owner confirmed this tenancy.
            String elsewhere = tenantClaimRoom(host, "Another Villa", ownerMobile);
            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, roomReview(elsewhere))
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().is(422));

            String named = tenantClaimRoom(host, "Consented Villa", ownerMobile);
            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, roomReview(named))
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().isOk());
            assertThat(roomTier(named)).isEqualTo("tenant");
        }

        @Test
        @DisplayName("a withdrawn agreement outranks the queue row it left behind")
        void withdrawingTheClaimBeatsAStaleVerdict() throws Exception {
            User host = user("9820000064", "Switcher");
            User ops = user("9820000065", "Ops9", Roles.Wire.STAFF);
            String ownerConsentMobile = recordOwnerConsent(host, null, "Agreement Flat", "Baner");
            String roomId = tenantClaimRoom(host, "Agreement Flat", ownerConsentMobile);
            String reviewId = roomReview(roomId);

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Baner",
                                     "society":"A Different Flat","rentShare":15000,
                                     "hostRole":"tenant","agreementDeclared":false,
                                     "ownerConsentMobile":"%s",
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """.formatted(ownerConsentMobile)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.verificationTier").value("identity"));

            // Dropping to identity needs no review, so the edit does not re-open the row either:
            // it still says `tenant`, and still says Agreement Flat.
            assertThat(jdbc.queryForObject(
                    "select status from flatmate_reviews where id = ?::uuid",
                    String.class, reviewId)).isEqualTo("pending");

            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, reviewId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"approved\"}"))
                    .andExpect(status().isOk());

            // The bait-and-switch this queue exists to stop: file a real agreement, move the post
            // to an unread flat while it is pending, and collect the badge on Ops' yes.
            assertThat(roomTier(roomId)).isEqualTo("identity");
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Baner")
                            .param("verifiedOnly", "true").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(roomId))));
        }

        @Test
        @DisplayName("archiving the listing takes the owner-tier badge back with it")
        void ownerTierIsReconciledWhenTheListingStopsStanding() throws Exception {
            User host = user("9820000066", "Landlord", Roles.Wire.OWNER);
            User ops = user("9820000067", "Ops10", Roles.Wire.STAFF);

            Property flat = new Property(host, "Flat in Kothrud", "rent", "apartment",
                    38000L, "Kothrud", "Pune");
            flat.setBhk(BigDecimal.valueOf(3));
            flat.setStatus(PropertyStatus.APPROVED);
            properties.saveAndFlush(flat);

            String created = mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"roomType":"Private room","locality":"Kothrud",
                                     "society":"Deed Standing","rentShare":19000,
                                     "hostRole":"owner","propertyId":"%s",
                                     "photos":["https://cdn.example/1.jpg"]}
                                    """.formatted(flat.getId())))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.verificationTier").value("owner"))
                    .andExpect(jsonPath("$.verified").value(true))
                    .andReturn().getResponse().getContentAsString();
            String roomId = idOf(created);

            reconcile(ops).andExpect(jsonPath("$.demoted").value(0));
            assertThat(roomTier(roomId)).isEqualTo("owner");

            flat.archive("Owner withdrew the listing");
            properties.saveAndFlush(flat);

            // Owner tier is the one rung the queue cannot reach, so the sweep is the only lever:
            // deriveTier runs only on a host-initiated write, and owner-tier posts never queue.
            reconcile(ops).andExpect(jsonPath("$.demoted").value(1));
            assertThat(roomTier(roomId)).isEqualTo("identity");
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "Kothrud")
                            .param("verifiedOnly", "true").param("size", "100"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.not(Matchers.hasItem(roomId))));

            // Idempotent: it re-asks a question rather than applying a delta, so the second person
            // working the queue finds nothing left to do instead of demoting the post twice.
            reconcile(ops).andExpect(jsonPath("$.demoted").value(0));
            assertThat(roomTier(roomId)).isEqualTo("identity");
        }

        @Test
        @DisplayName("a host cannot run the owner-tier pass over everybody else's posts")
        void reconcileIsStaffOnly() throws Exception {
            User host = user("9820000068", "NotOps", Roles.Wire.OWNER);
            mvc.perform(post(Routes.Moderation.FLATMATE_OWNER_TIER_RECONCILE)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("a rejection without a reason is refused")
        void rejectionNeedsAReason() throws Exception {
            User host = user("9820000052", "Claimer2");
            User ops = user("9820000053", "Ops2", Roles.Wire.STAFF);
            String roomId = tenantClaimRoom(host, "Doubtful Heights");

            // A host told "no" with no reason cannot fix anything.
            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, roomReview(roomId))
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

    // reviewStatus travels on the feed and detail DTOs so the badge and the "verified only" filter
    // are answerable server-side; read from localStorage instead, both silently stop working.
    @Nested
    @DisplayName("the Ops verdict, server-side")
    class ReviewStatusOnTheWire {

        /** Post a group whose host claims a rent agreement, so a review is queued behind it. */
        private String tenantClaimGroup(User host, String title, String locality) throws Exception {
            String ownerConsentMobile = recordOwnerConsent(host, title, null, locality);
            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"%s","locality":"%s","rent":40000,"seats":3,
                                     "seatsOpen":1,"name":"Host","role":"tenant",
                                     "agreement":true,%s,
                                     "consentMobile":"%s"}
                                    """.formatted(title, locality, FlatmateAgreementFixture.EVIDENCE,
                                    ownerConsentMobile)))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.verificationTier").value("tenant"))
                    .andReturn().getResponse().getContentAsString();
            return publish("flatmate_groups", idOf(json));
        }

        private void decide(User ops, String groupId, String decision) throws Exception {
            String reviewId = jdbc.queryForObject(
                    "select id::text from flatmate_reviews where group_id = ?::uuid",
                    String.class, groupId);
            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, reviewId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"%s\"}".formatted(decision)))
                    .andExpect(status().isOk());
        }

        @Test
        @DisplayName("a pending claim is on the wire as pending, and the badge filter drops it")
        void pendingIsVisibleAndFiltered() throws Exception {
            User host = user("9820000070", "Waiting");
            String id = tenantClaimGroup(host, "Awaiting Ops", "VerdictTownA");

            mvc.perform(get(Routes.Flatmates.GROUPS).param("locality", "VerdictTownA"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$.content[0].id").value(id))
                    // Undecided is not the same as absent: the host is owed the difference.
                    .andExpect(jsonPath("$.content[0].reviewStatus").value("pending"));

            mvc.perform(get(Routes.Flatmates.GROUPS)
                            .param("locality", "VerdictTownA").param("verifiedOnly", "true"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("an approved claim survives the badge filter it used to be dropped by")
        void approvedSurvivesTheFilter() throws Exception {
            User host = user("9820000071", "Approved");
            User ops = user("9820000072", "Ops3", Roles.Wire.STAFF);
            String id = tenantClaimGroup(host, "Ops said yes", "VerdictTownB");

            decide(ops, id, "approved");

            mvc.perform(get(Routes.Flatmates.GROUPS)
                            .param("locality", "VerdictTownB").param("verifiedOnly", "true"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$.content[0].id").value(id))
                    .andExpect(jsonPath("$.content[0].reviewStatus").value("approved"));
        }

        @Test
        @DisplayName("a rejected claim is still listed, but is not verified")
        void rejectedIsListedButUnverified() throws Exception {
            User host = user("9820000073", "Rejected");
            User ops = user("9820000074", "Ops4", Roles.Wire.STAFF);
            String id = tenantClaimGroup(host, "Ops said no", "VerdictTownC");

            String reviewId = jdbc.queryForObject(
                    "select id::text from flatmate_reviews where group_id = ?::uuid",
                    String.class, id);
            mvc.perform(patch(Routes.Moderation.FLATMATE_REVIEW_BY_ID, reviewId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(ops))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"rejected\",\"note\":\"Illegible agreement\"}"))
                    .andExpect(status().isOk());

            // Failing verification is an unproven claim, not abuse — the post stays up.
            mvc.perform(get(Routes.Flatmates.GROUPS).param("locality", "VerdictTownC"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$.content[0].reviewStatus").value("rejected"));

            mvc.perform(get(Routes.Flatmates.GROUPS)
                            .param("locality", "VerdictTownC").param("verifiedOnly", "true"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("the host reads their own verdict off their own dashboard")
        void hostSeesTheirOwnVerdict() throws Exception {
            User host = user("9820000075", "Owner of it");
            User ops = user("9820000076", "Ops5", Roles.Wire.STAFF);
            String id = tenantClaimGroup(host, "Mine", "VerdictTownD");

            mvc.perform(get(Routes.Flatmates.MY_GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].reviewStatus").value("pending"));

            decide(ops, id, "approved");

            mvc.perform(get(Routes.Flatmates.MY_GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].reviewStatus").value("approved"));
        }

        @Test
        @DisplayName("a post nobody had to review carries no verdict at all")
        void noClaimMeansNoVerdict() throws Exception {
            User host = user("9820000077", "No claim");
            createGroup(host, "Just a group", "VerdictTownE");

            // Not "pending": there is nothing queued, and saying pending would invent a promise.
            mvc.perform(get(Routes.Flatmates.GROUPS).param("locality", "VerdictTownE"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$.content[0].reviewStatus").doesNotExist());
        }
    }

    // Each test isolates its data behind a unique locality and asserts an exact page size, because
    // "the filter narrowed something" is weaker than "the filter returned exactly these".
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
            publish("flatmate_rooms", idOf(json));
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
            publish("flatmate_groups", idOf(json));
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
