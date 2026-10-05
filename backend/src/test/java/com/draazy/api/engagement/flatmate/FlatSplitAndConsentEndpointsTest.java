package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmates — splits, owner consent and group applications")
class FlatSplitAndConsentEndpointsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    PropertyRepository properties;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        return user(mobile, name, Roles.Wire.OWNER);
    }

    private User user(String mobile, String name, String role) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private Property listing(User owner, String status, int bhk) {
        Property p = new Property(owner, "Flat in Baner", "rent", "apartment",
                45000L, "Baner", "Pune");
        p.setBhk(BigDecimal.valueOf(bhk));
        p.setStatus(status);
        return properties.saveAndFlush(p);
    }

    private String moveInFeed() throws Exception {
        return mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in")
                        .param("locality", "Baner").param("size", "50"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    private void tickChecklist(Property listing, User staff) throws Exception {
        String opened = mvc.perform(post("/properties/{id}/verification/start", listing.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        List<String> items = com.jayway.jsonpath.JsonPath.read(opened, "$.checklist[*].item");
        for (String item : items) {
            mvc.perform(patch("/properties/{id}/verification/checklist", listing.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"item\":\"" + item + "\",\"pass\":true}"))
                    .andExpect(status().isOk());
        }
    }

    private static String splitBody(int maxOccupants, String... kinds) {
        StringBuilder rooms = new StringBuilder();
        for (String kind : kinds) {
            if (!rooms.isEmpty()) {
                rooms.append(',');
            }
            rooms.append("{\"roomKind\":\"").append(kind).append("\",\"rent\":15000}");
        }
        return "{\"maxOccupants\":" + maxOccupants + ",\"rooms\":[" + rooms + "]}";
    }

    @Nested
    @DisplayName("splitting a flat")
    class Splitting {

        @Test
        @DisplayName("an approved flat's rooms are born owner-tier and badged")
        void approvedParentConfersTheBadge() throws Exception {
            User owner = user("9830000001", "Owner");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(4, "master", "bedroom")))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.count").value(2))
                    .andExpect(jsonPath("$.tier").value("owner"))
                    .andExpect(jsonPath("$.pending").value(false))
                    .andExpect(jsonPath("$.rooms[0].verified").value(true))

                    .andExpect(jsonPath("$.rooms[0].attachedBath").value("attached"))
                    .andExpect(jsonPath("$.rooms[1].attachedBath").value("shared"))

                    .andExpect(jsonPath("$.rooms[0].priceBasis").value("room"));
        }

        @Test
        @DisplayName("a pending flat's rooms start unbadged — the badge is inherited, not asserted")
        void roomsInheritThePendingParentsLackOfBadge() throws Exception {
            User owner = user("9830000002", "Hopeful");
            Property flat = listing(owner, PropertyStatus.PENDING, 2);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(3, "bedroom", "living")))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.tier").value("identity"))
                    .andExpect(jsonPath("$.pending").value(true))
                    .andExpect(jsonPath("$.rooms[0].verified").value(false));
        }

        // `SpecCoverageTest` only proves served routes are declared; this route was declared but absent.
        // The unauthenticated read must return rooms without leaking sibling owner-only data.
        @Test
        @DisplayName("approving the flat later promotes its split rooms to owner-tier (D287)")
        void approvalPromotesRoomsSplitWhilePending() throws Exception {
            User owner = user("9830000012", "Patient");
            User admin = user("9830000013", "Checker", Roles.Wire.ADMIN);
            Property flat = listing(owner, PropertyStatus.PENDING, 2);
            flat.setLocalitySlug("baner");
            properties.saveAndFlush(flat);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(3, "bedroom", "living")))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.tier").value("identity"));

            tickChecklist(flat, admin);
            mvc.perform(patch(Routes.Moderation.PROPERTY_STATUS, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"approved\"}"))
                    .andExpect(status().isOk());

            assertThat(jdbc.queryForList(
                    "select verification_tier from flatmate_rooms where property_id = ? and not archived",
                    String.class, flat.getId()))
                    .hasSize(2)
                    .containsOnly("owner");
        }

        @Test
        @DisplayName("a cleared room is published, without host contact or the moderation verdict")
        void clearedRoomsAreReadableAnonymously() throws Exception {
            User owner = user("9830000011", "Splitter2");
            User admin = user("9830000012", "Moderator", Roles.Wire.ADMIN);
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            String split = mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(4, "master", "bedroom")))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String firstRoom = com.jayway.jsonpath.JsonPath.read(split, "$.rooms[0].id");
            String sibling = com.jayway.jsonpath.JsonPath.read(split, "$.rooms[1].id");

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", firstRoom))
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"approved\"}"))
                    .andExpect(status().isOk());

                    // In a filtered list this can only say "approved"; if filtering regresses,
                    // it becomes a leaked verdict.
            String feed = moveInFeed();
            assertThat(feed).contains(firstRoom).doesNotContain(sibling);
            String card = "$.content[?(@.id=='" + firstRoom + "')]";
            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in")
                            .param("locality", "Baner").param("size", "50"))
                    .andExpect(jsonPath(card + ".hostMobile").value(Matchers.empty()))

                    .andExpect(jsonPath(card + ".modStatus").value(Matchers.empty()));
        }

        @Test
        @DisplayName("only the owner may split, and only a rent listing")
        void ownerAndRentOnly() throws Exception {
            User owner = user("9830000003", "Owner2");
            User stranger = user("9830000004", "Stranger");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(2, "bedroom")))
                    .andExpect(status().isForbidden());

            Property sale = new Property(owner, "Sale flat", "buy", "apartment", 9000000L,
                    "Baner", "Pune");
            sale.setBhk(BigDecimal.valueOf(2));
            sale.setStatus(PropertyStatus.APPROVED);
            Property saved = properties.saveAndFlush(sale);

            mvc.perform(post(Routes.Properties.SPLIT, saved.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(2, "bedroom")))
                    .andExpect(status().isConflict());
        }

        @Test
        @DisplayName("splitting twice is refused")
        void onceOnly() throws Exception {
            User owner = user("9830000005", "Owner3");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);
            String body = splitBody(3, "bedroom");

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isCreated());

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isConflict());
        }

        @ParameterizedTest(name = "{0}")
        @CsvSource({
                "rooms beyond the BHK allowance, 9830000006, 6, master|bedroom|living|bedroom",
                "occupancy cap above three a room, 9830000007, 9, bedroom|master"})
        @DisplayName("an oversized split is refused")
        void splitIsBounded(String label, String mobile, int maxOccupants, String kinds)
                throws Exception {
            User owner = user(mobile, "Optimist");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            // Lettable rooms = bedrooms + hall, so a 2 BHK tops out at three; the flat cap sits
            // between one and three people per room. 422 rather than 400: the contract declares
            // only 403/409/422 for this operation.
            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(maxOccupants, kinds.split("\\|"))))
                    .andExpect(status().isUnprocessableEntity());
        }

        @Test
        @DisplayName("withdrawing is refused once anyone has moved in")
        void unsplitRefusedWhenOccupied() throws Exception {
            User owner = user("9830000008", "Landlord");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(3, "bedroom")))
                    .andExpect(status().isCreated());

            String roomId = jdbc.queryForObject(
                    "select id::text from flatmate_rooms where property_id = ?::uuid",
                    String.class, flat.getId().toString());

            mvc.perform(patch(Routes.Flatmates.ROOM_OCCUPANTS, roomId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"occupants\":2}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.occupants").value(2));

            mvc.perform(delete(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isConflict());
        }

        @Test
        @DisplayName("an empty split can be withdrawn, and the rooms leave the feed")
        void unsplitWhenEmpty() throws Exception {
            User owner = user("9830000009", "Rethink");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(3, "bedroom", "master")))
                    .andExpect(status().isCreated());

            mvc.perform(delete(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                    .andExpect(status().isNoContent());

            Integer live = jdbc.queryForObject(
                    "select count(*) from flatmate_rooms where property_id = ?::uuid "
                            + "and archived = false",
                    Integer.class, flat.getId().toString());
            assertThat(live).isZero();
        }

        @Test
        @DisplayName("occupants are clamped to the flat cap across sibling rooms")
        void occupantsClampAcrossSiblings() throws Exception {
            User owner = user("9830000010", "Counter");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(2, "bedroom", "master")))
                    .andExpect(status().isCreated());

            List<String> roomIds = jdbc.queryForList(
                    "select id::text from flatmate_rooms where property_id = ?::uuid "
                            + "order by created_at",
                    String.class, flat.getId().toString());

            mvc.perform(patch(Routes.Flatmates.ROOM_OCCUPANTS, roomIds.getFirst())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"occupants\":2}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.occupants").value(2));

            // The flat cap is 2 and both are taken, so the sibling clamps to 0 however many
            // the owner claims. Walking around the rooms one at a time cannot exceed the cap.
            mvc.perform(patch(Routes.Flatmates.ROOM_OCCUPANTS, roomIds.get(1))
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"occupants\":3}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.occupants").value(0));
        }
    }

    @Nested
    @DisplayName("owner consent")
    class OwnerConsent {

        @Test
        @DisplayName("a wrong code records nothing")
        void wrongCodeIsRefused() throws Exception {
            User tenant = user("9830000022", "Tenant2", Roles.Wire.BUYER);
            String groupId = createGroup(tenant);

            mvc.perform(post(Routes.Flatmates.GROUP_OWNER_CONSENT, groupId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"ownerMobile\":\"9830000023\"}"))
                    .andExpect(status().isOk());

            mvc.perform(post(Routes.Flatmates.GROUP_OWNER_CONSENT, groupId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"ownerMobile\":\"9830000023\",\"otp\":\"000000\"}"))
                    .andExpect(status().isUnauthorized());

            Boolean consented = jdbc.queryForObject(
                    "select owner_consent from flatmate_groups where id = ?::uuid",
                    Boolean.class, groupId);
            assertThat(consented).isFalse();
        }

        @Test
        @DisplayName("only the group's host may request consent for it")
        void hostScoped() throws Exception {
            User tenant = user("9830000025", "Host", Roles.Wire.BUYER);
            User other = user("9830000026", "Meddler", Roles.Wire.BUYER);
            String groupId = createGroup(tenant);

            mvc.perform(post(Routes.Flatmates.GROUP_OWNER_CONSENT, groupId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"ownerMobile\":\"9830000027\"}"))
                    .andExpect(status().isForbidden());
        }

        private String createGroup(User host) throws Exception {
            String json = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Replacement flatmate","locality":"Baner",
                                     "rent":40000,"name":"Host","role":"tenant"}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        }
    }

    @Nested
    @DisplayName("group applications")
    class GroupApplications {

        @Test
        @DisplayName("the admin board is staff-only")
        void boardIsStaffOnly() throws Exception {
            User consumer = user("9830000030", "Nosy", Roles.Wire.BUYER);

            mvc.perform(get(Routes.Moderation.GROUP_APPLICATIONS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(consumer)))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("moderating writes the admin axis and never the owner's decision")
        void moderationCannotDecideForTheOwner() throws Exception {
            User owner = user("9830000031", "Landlord");
            User applicant = user("9830000032", "Applicant", Roles.Wire.BUYER);
            User admin = user("9830000033", "Admin", Roles.Wire.ADMIN);
            Property flat = listing(owner, PropertyStatus.APPROVED, 3);

            String groupJson = mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(applicant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Four of us","locality":"Baner","rent":45000,
                                     "seats":4,"name":"Applicant"}
                                    """))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            String groupId = groupJson.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

            // No API creates an application yet (see the class note in the summary), so the row
            // is seeded directly to exercise the two admin operations the contract declares.
            String appId = jdbc.queryForObject(
                    "insert into flatmate_group_applications (listing_id, group_id, applicant_id) "
                            + "values (?::uuid, ?::uuid, ?::uuid) returning id::text",
                    String.class, flat.getId().toString(), groupId, applicant.getId().toString());

            mvc.perform(get(Routes.Moderation.GROUP_APPLICATIONS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)))
                    .andExpect(jsonPath("$.content[0].groupTitle").value("Four of us"))
                    .andExpect(jsonPath("$.content[0].rent").value(45000))

                    .andExpect(jsonPath("$.content[0].perHead").value(45000 / 4))
                    .andExpect(jsonPath("$.content[0].status").value("pending"));

            mvc.perform(patch(Routes.Moderation.GROUP_APPLICATION_BY_ID, appId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"removed\",\"note\":\"spam\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.modStatus").value("removed"))

                    // "We took this down" and "the owner said no" are different facts, and
                    // only one of them is true.
                    .andExpect(jsonPath("$.status").value("pending"));
        }
    }
}
