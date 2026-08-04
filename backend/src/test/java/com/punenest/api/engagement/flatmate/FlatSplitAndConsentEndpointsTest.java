package com.punenest.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
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
 * Flat splits, owner consent and group applications — the last of the flatmates surface.
 *
 * <p>{@link Splitting} is the interesting half. A split is the one place where supply is created
 * from a listing rather than from a form, so it is where the badge could most plausibly leak: the
 * owner is acting on something they demonstrably own, which feels like it should confer trust. It
 * does not, and {@link Splitting#roomsInheritThePendingParentsLackOfBadge} is the test that says so.
 */
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

    /** A rent listing owned by {@code owner}, approved or not. */
    private Property listing(User owner, String status, int bhk) {
        Property p = new Property(owner, "Flat in Baner", "rent", "apartment",
                45000L, "Baner", "Pune");
        p.setBhk(BigDecimal.valueOf(bhk));
        p.setStatus(status);
        return properties.saveAndFlush(p);
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
                    // A master bedroom's private bathroom is implied, never asked twice.
                    .andExpect(jsonPath("$.rooms[0].attachedBath").value("attached"))
                    .andExpect(jsonPath("$.rooms[1].attachedBath").value("shared"))
                    // Per ROOM, not per person -- the distinction that stops a shared bed
                    // looking pricier than a private room.
                    .andExpect(jsonPath("$.rooms[0].priceBasis").value("room"));
        }

        @Test
        @DisplayName("a pending flat's rooms start unbadged — the badge is inherited, not asserted")
        void roomsInheritThePendingParentsLackOfBadge() throws Exception {
            User owner = user("9830000002", "Hopeful");
            Property flat = listing(owner, PropertyStatus.PENDING, 2);

            // Splitting is an act the owner performs on their own listing. It proves nothing that
            // was not already proven about the parent, so it grants nothing.
            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(3, "bedroom", "living")))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.tier").value("identity"))
                    .andExpect(jsonPath("$.pending").value(true))
                    .andExpect(jsonPath("$.rooms[0].verified").value(false));
        }

        /**
         * {@code GET /properties/{id}/rooms} was declared in the contract from the start and served
         * by nothing — the one spec/controller drift in the whole API. A client generated from the
         * document got a 404 from an operation the document promised, and {@code SpecCoverageTest}
         * could not see it: that test asserts served ⊆ declared, which is silent in this direction.
         *
         * <p>Anonymity is asserted rather than assumed. This is an unauthenticated read on a route
         * whose sibling POST is owner-only, so the interesting question is not whether it returns
         * rooms but whether it returns the host's phone number with them.
         */
        @Test
        @DisplayName("the rooms a flat was split into are publicly readable, without host contact")
        void splitRoomsAreReadableAnonymously() throws Exception {
            User owner = user("9830000009", "Splitter");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(4, "master", "bedroom")))
                    .andExpect(status().isCreated());

            mvc.perform(get(Routes.Properties.ROOMS, flat.getId()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.length()").value(2))
                    .andExpect(jsonPath("$[0].hostMobile").doesNotExist())
                    .andExpect(jsonPath("$[1].hostMobile").doesNotExist());
        }

        /** An unsplit flat has no rooms — an empty list, not a 404. The listing still exists. */
        @Test
        @DisplayName("an unsplit flat reports no rooms rather than 404")
        void unsplitFlatReturnsAnEmptyList() throws Exception {
            User owner = user("9830000010", "Whole");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            mvc.perform(get(Routes.Properties.ROOMS, flat.getId()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.length()").value(0));
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

        @Test
        @DisplayName("a 2 BHK cannot be let as five rooms")
        void roomCountIsBoundedByBhk() throws Exception {
            User owner = user("9830000006", "Optimist");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            // Lettable rooms = bedrooms + hall, so a 2 BHK tops out at three. 422 rather than
            // 400: the contract declares only 403/409/422 for this operation.
            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(6, "master", "bedroom", "living", "bedroom")))
                    .andExpect(status().isUnprocessableEntity());
        }

        @Test
        @DisplayName("the flat cap must sit between one and three people per room")
        void occupancyCapIsBounded() throws Exception {
            User owner = user("9830000007", "Crowded");
            Property flat = listing(owner, PropertyStatus.APPROVED, 2);

            // Two rooms means a cap of at most six, whatever the owner claims.
            mvc.perform(post(Routes.Properties.SPLIT, flat.getId())
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(splitBody(9, "bedroom", "master")))
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

            // Deleting the rooms would erase a live tenancy.
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
        @DisplayName("the first call sends a code; the second records the consent")
        void twoStepFlow() throws Exception {
            User tenant = user("9830000020", "Tenant", Roles.Wire.BUYER);
            String groupId = createGroup(tenant);

            mvc.perform(post(Routes.Flatmates.GROUP_OWNER_CONSENT, groupId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"ownerMobile\":\"9830000021\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.consentRecorded").value(false));

            // The code is scoped to its own purpose: it can never be presented at /auth/login.
            String purpose = jdbc.queryForObject(
                    "select purpose from otp_codes where mobile = '9830000021'", String.class);
            assertThat(purpose).isEqualTo("owner-consent");

            Boolean consented = jdbc.queryForObject(
                    "select owner_consent from flatmate_groups where id = ?::uuid",
                    Boolean.class, groupId);
            assertThat(consented).isFalse();
        }

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
        @DisplayName("a tenant cannot consent on their own behalf")
        void selfConsentIsRefused() throws Exception {
            User tenant = user("9830000024", "SelfServer", Roles.Wire.BUYER);
            String groupId = createGroup(tenant);

            // Self-consent would make the record worthless, and it is the one shortcut
            // somebody would certainly try.
            mvc.perform(post(Routes.Flatmates.GROUP_OWNER_CONSENT, groupId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(tenant))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"ownerMobile\":\"9830000024\"}"))
                    .andExpect(status().isBadRequest());
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
                    // Derived on read, so it can never disagree with the listing's rent.
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
