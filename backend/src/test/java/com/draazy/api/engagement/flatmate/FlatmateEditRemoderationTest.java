package com.draazy.api.engagement.flatmate;

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

/** Every supply fixture declares an agreement: at identity tier the ladder returns {@code pending}
 *  for any edit whatever {@link FlatmateEditRules} says, so such a fixture asserts nothing. */
@DisplayName("Flatmate edits — re-moderated for what changed (D4, D5)")
class FlatmateEditRemoderationTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name, String role) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private User host(String mobile, String name) {
        return user(mobile, name, Roles.Wire.BUYER);
    }

    private User admin(String mobile) {
        return user(mobile, "Mod", Roles.Wire.ADMIN);
    }

    private static String idIn(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    /** A tenant-tier room: agreement declared, so it is on the board from the first write. */
    private static String roomBody(String locality, String society, String roomType, int rent,
            String photo, String note) {
        return """
                {"bhk":"2","roomType":"%s","attachedBath":"attached","furnishing":"semi",
                 "locality":"%s","society":"%s","rentShare":%d,"deposit":30000,
                 "availableFrom":"2026-09-01","lookingFor":"any","foodPref":"any",
                 "agreementDeclared":true,"photos":["%s"],"note":"%s",%s}
                """.formatted(roomType, locality, society, rent, photo, note,
                FlatmateAgreementFixture.EVIDENCE);
    }

    private String createRoom(User owner, String body) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                // The premise of every test below: it is already public.
                .andExpect(jsonPath("$.modStatus").value("live"))
                .andReturn().getResponse().getContentAsString();
        return idIn(json);
    }

    private void editRoom(User owner, String id, String body) throws Exception {
        mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    /** What the {@code recheck} board says about one row, or an empty page. */
    private org.springframework.test.web.servlet.ResultActions recheckBoard(User mod, String kind)
            throws Exception {
        return mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                        .param("kind", kind)
                        .param("modStatus", "recheck")
                        .header(HttpHeaders.AUTHORIZATION, bearer(mod)))
                .andExpect(status().isOk());
    }

    @Nested
    @DisplayName("foundation — the post stops being the one that was approved")
    class Foundation {

        @Test
        @DisplayName("moving a room to another locality takes it off the board")
        void relocatingSendsItBack() throws Exception {
            User owner = host("9812000001", "Relocator");
            String id = createRoom(owner,
                    roomBody("EditTownA", "Alpha Heights", "Private room", 15000,
                            "https://cdn.example/a1.jpg", "Sunny room."));

            editRoom(owner, id,
                    roomBody("EditTownZ", "Alpha Heights", "Private room", 15000,
                            "https://cdn.example/a1.jpg", "Sunny room."));

            // The locality also feeds the duplicate-address fingerprint, so nothing about it is
            // cosmetic.
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "EditTownZ"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));

            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "room")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9812000002"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].modStatus",
                            Matchers.contains("pending")));
        }

        @Test
        @DisplayName("and it is not also filed as a re-check — the two are exclusive")
        void foundationDoesNotDoubleFile() throws Exception {
            User owner = host("9812000003", "Doubler");
            String id = createRoom(owner,
                    roomBody("EditTownB", "Beta Court", "Private room", 15000,
                            "https://cdn.example/b1.jpg", "Sunny room."));

            // Both a foundation field and a re-checked one, in one PATCH.
            editRoom(owner, id,
                    roomBody("EditTownY", "Beta Court", "Private room", 21000,
                            "https://cdn.example/b2.jpg", "Rewritten."));

            // A row waiting in the queue is not also a work item on a second board: the moderator's
            // second read would be about an invisible post.
            recheckBoard(admin("9812000004"), "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]", Matchers.hasSize(0)));
        }
    }

    @Nested
    @DisplayName("stays live, re-checked — the evidence moved, the offer did not")
    class StaysLiveRechecked {

        @Test
        @DisplayName("swapping every photo leaves the room up and raises a work item")
        void photoSwapIsRechecked() throws Exception {
            User owner = host("9812000010", "Swapper");
            String id = createRoom(owner,
                    roomBody("EditTownC", "Gamma Towers", "Private room", 15000,
                            "https://cdn.example/c1.jpg", "Sunny room."));

            editRoom(owner, id,
                    roomBody("EditTownC", "Gamma Towers", "Private room", 15000,
                            "https://cdn.example/c-swapped.jpg", "Sunny room."));

            // Still up: taking a room dark for a day whenever its pictures change teaches hosts not
            // to change them, and a stale gallery is its own harm.
            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "EditTownC"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));

            recheckBoard(admin("9812000011"), "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckReason",
                            Matchers.contains("photos")))
                    // A number burned into an image cannot be caught by reading the note.
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].photos[0]",
                            Matchers.contains("https://cdn.example/c-swapped.jpg")));
        }

        @Test
        @DisplayName("a second edit adds its field without moving the host's place in the queue")
        void reasonsAccumulateAndTheStampHolds() throws Exception {
            User owner = host("9812000012", "Repeater");
            User mod = admin("9812000013");
            String id = createRoom(owner,
                    roomBody("EditTownD", "Delta Nest", "Private room", 15000,
                            "https://cdn.example/d1.jpg", "Sunny room."));

            editRoom(owner, id,
                    roomBody("EditTownD", "Delta Nest", "Private room", 15000,
                            "https://cdn.example/d2.jpg", "Sunny room."));
            String firstStamp = recheckBoard(mod, "room").andReturn().getResponse()
                    .getContentAsString();

            editRoom(owner, id,
                    roomBody("EditTownD", "Delta Nest", "Private room", 19000,
                            "https://cdn.example/d2.jpg", "Sunny room."));

            recheckBoard(mod, "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckReason",
                            Matchers.contains("photos, rent")))
                    // The stamp is the SLA: re-stamping on every edit would let a host who re-crops
                    // a photo daily walk their own row back down the queue forever.
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckRequestedAt",
                            Matchers.contains(stampOf(firstStamp, id))));
        }

        @Test
        @DisplayName("deciding it clears the work item, so the backlog shrinks")
        void moderatingClearsTheRecheck() throws Exception {
            User owner = host("9812000014", "Cleared");
            User mod = admin("9812000015");
            String id = createRoom(owner,
                    roomBody("EditTownE", "Epsilon Row", "Private room", 15000,
                            "https://cdn.example/e1.jpg", "Sunny room."));

            editRoom(owner, id,
                    roomBody("EditTownE", "Epsilon Row", "Private room", 15000,
                            "https://cdn.example/e2.jpg", "Sunny room."));

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"approved\"}"))
                    .andExpect(status().isOk());

            recheckBoard(mod, "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]", Matchers.hasSize(0)));
        }
    }

    @Nested
    @DisplayName("silent — a bounded facet moved and nobody needs to know")
    class Silent {

        @Test
        @DisplayName("changing the food preference raises nothing")
        void chipListFacetsAreSilent() throws Exception {
            User owner = host("9812000020", "Quiet");
            String id = createRoom(owner,
                    roomBody("EditTownF", "Zeta Villa", "Private room", 15000,
                            "https://cdn.example/f1.jpg", "Sunny room."));

            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                     "furnishing":"semi","locality":"EditTownF","society":"Zeta Villa",
                                     "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                                     "lookingFor":"any","foodPref":"veg","agreementDeclared":true,
                                     "photos":["https://cdn.example/f1.jpg"],"note":"Sunny room.",%s}
                                    """.formatted(FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isOk());

            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "EditTownF"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));

            // The gate exists because the *unbounded* strings are where abuse lands; a value the UI
            // only offers as one of three chips cannot carry a phone number.
            recheckBoard(admin("9812000021"), "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("a phone number typed into 'overlooking' does not slip past as a facet")
        void unboundedFacetsAreNotSilent() throws Exception {
            User owner = host("9812000022", "Sideloader");
            String id = createRoom(owner,
                    roomBody("EditTownI", "Iota House", "Private room", 15000,
                            "https://cdn.example/i1.jpg", "Sunny room."));

            /* `facing`, `overlooking` and `lifestyle` are chips in the wizard and free text at the
               endpoint, rendered straight onto the anonymous feed. */
            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                     "furnishing":"semi","locality":"EditTownI","society":"Iota House",
                                     "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                                     "lookingFor":"any","foodPref":"any","agreementDeclared":true,
                                     "overlooking":"call 98200 11223","photos":["https://cdn.example/i1.jpg"],
                                     "note":"Sunny room.",%s}
                                    """.formatted(FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isOk());

            recheckBoard(admin("9812000023"), "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckReason",
                            Matchers.contains("details")));
        }

        @Test
        @DisplayName("moving the ask into the deposit is re-checked like moving it into the rent")
        void depositIsPartOfTheAsk() throws Exception {
            User owner = host("9812000024", "Repricer");
            String id = createRoom(owner,
                    roomBody("EditTownJ", "Kappa Court", "Private room", 15000,
                            "https://cdn.example/j1.jpg", "Sunny room."));

            // Watching `rentShare` alone leaves the other half of the money unwatched.
            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                     "furnishing":"semi","locality":"EditTownJ","society":"Kappa Court",
                                     "rentShare":15000,"deposit":300000,"availableFrom":"2026-09-01",
                                     "lookingFor":"any","foodPref":"any","agreementDeclared":true,
                                     "photos":["https://cdn.example/j1.jpg"],"note":"Sunny room.",%s}
                                    """.formatted(FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isOk());

            recheckBoard(admin("9812000025"), "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckReason",
                            Matchers.contains("deposit")));
        }
    }

    @Nested
    @DisplayName("an edit may lower visibility, never raise it")
    class Takedowns {

        /** Hide the room by moderator verdict, then have the host re-save an unchanged body. */
        private void hideThenResave(String verdict, String locality, String society, User owner,
                User mod, String id) throws Exception {
            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"" + verdict + "\"}"))
                    .andExpect(status().isOk());

            editRoom(owner, id, roomBody(locality, society, "Private room", 15000,
                    "https://cdn.example/k1.jpg", "Sunny room."));

            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", locality))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "room").param("modStatus", "pending")
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]",
                            Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("re-saving an unchanged body does not undo a 'removed' verdict")
        void anEditCannotUndoARemoval() throws Exception {
            User owner = host("9812000026", "Persistent");
            User mod = admin("9812000027");
            String id = createRoom(owner, roomBody("EditTownK", "Lambda Lodge", "Private room",
                    15000, "https://cdn.example/k1.jpg", "Sunny room."));

            /* The ladder reads the tier and cannot see a verdict, so on its own it would send a
               tenant-tier room back `live` on the host's next save. */
            hideThenResave("removed", "EditTownK", "Lambda Lodge", owner, mod, id);
        }

        @Test
        @DisplayName("nor a 'flagged' one, which is the verdict a host can actually provoke")
        void anEditCannotUndoAFlag() throws Exception {
            User owner = host("9812000028", "Reflagger");
            User mod = admin("9812000029");
            String id = createRoom(owner, roomBody("EditTownL", "Mu Manor", "Private room",
                    15000, "https://cdn.example/k1.jpg", "Sunny room."));

            /* Naming the exempt states one by one is how a state gets missed, so the rule is "was
               it public" — a question the ladder can be asked about any state that exists later. */
            hideThenResave("flagged", "EditTownL", "Mu Manor", owner, mod, id);
        }

        @Test
        @DisplayName("declaring an agreement mid-edit does not publish an unreviewed post")
        void aTierBumpCannotPublishAPendingPost() throws Exception {
            User owner = host("9812000031", "Selfpromoter");
            User mod = admin("9812000032");
            String body = """
                    {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                     "furnishing":"semi","locality":"EditTownM","society":"Nu Nest",
                     "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                     "lookingFor":"any","foodPref":"any","agreementDeclared":%s,%s
                     "photos":["https://cdn.example/m1.jpg"],"note":"Sunny room."}
                    """;
            // No agreement, so the ladder leaves it at identity tier: pending, never reviewed.
            String id = idIn(mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body.formatted("false", "")))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.modStatus").value("pending"))
                    .andReturn().getResponse().getContentAsString());

            /* A declared agreement moves the tier and is silent by design, so on the edit path it
               could let a post already awaiting a human walk itself onto the feed. The evidence has
               to be real here: a bare flag no longer bumps the tier, so without it this asserts
               nothing. */
            editRoom(owner, id, body.formatted("true", FlatmateAgreementFixture.EVIDENCE + ","));

            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "EditTownM"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "room").param("modStatus", "pending")
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]",
                            Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("moving only the map pin re-checks the room without hiding it")
        void movingThePinIsRechecked() throws Exception {
            User owner = host("9812000033", "Pinmover");
            String id = createRoom(owner, roomBody("EditTownN", "Xi Court", "Private room",
                    15000, "https://cdn.example/n1.jpg", "Sunny room."));

            /* The locality text is what a moderator cross-checks, so a room whose coordinates move
               across the city reads as unchanged. Not prose, so the first cut let it through. */
            mvc.perform(patch(Routes.Flatmates.ROOM_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                     "furnishing":"semi","locality":"EditTownN","society":"Xi Court",
                                     "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                                     "lookingFor":"any","foodPref":"any","agreementDeclared":true,
                                     "lat":18.5362,"lng":73.8939,
                                     "photos":["https://cdn.example/n1.jpg"],"note":"Sunny room.",%s}
                                    """.formatted(FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isOk());

            recheckBoard(admin("9812000034"), "room")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckReason",
                            Matchers.contains("map pin")));
        }
    }

    @Nested
    @DisplayName("a group keeps its default locality without being taken down for it")
    class Groups {

        private String createGroup(User owner, String title, String locality, int rent)
                throws Exception {
            return idIn(mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"%s","locality":"%s","policy":"any","rent":%d,
                                     "seats":3,"seatsOpen":1,"name":"Host","tags":[],
                                     "agreement":true,"note":"Chill flat.",%s}
                                    """.formatted(title, locality, rent,
                                    FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.modStatus").value("live"))
                    .andReturn().getResponse().getContentAsString());
        }

        @Test
        @DisplayName("an edit that keeps the locality re-checks the title, and stays up")
        void unchangedLocalityIsNotARelocation() throws Exception {
            User owner = host("9812000030", "Grouper");
            String id = createGroup(owner, "Three of us", "EditTownP", 40000);

            mvc.perform(patch(Routes.Flatmates.GROUP_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Four of us now","locality":"EditTownP","policy":"any",
                                     "rent":40000,"seats":3,"seatsOpen":1,"name":"Host","tags":[],
                                     "agreement":true,"note":"Chill flat.",%s}
                                    """.formatted(FlatmateAgreementFixture.EVIDENCE)))
                    .andExpect(status().isOk());

            recheckBoard(admin("9812000031"), "group")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckReason",
                            Matchers.contains("title")));
        }

        @Test
        @DisplayName("a blank locality is refused rather than defaulted to a locality nobody named")
        void blankLocalityIsRefused() throws Exception {
            User owner = host("9812000032", "Grouper");

            mvc.perform(post(Routes.Flatmates.GROUPS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"title":"Three of us","locality":"","policy":"any","rent":40000,
                                     "seats":3,"seatsOpen":1,"name":"Host","tags":[],
                                     "agreement":true,"note":"Chill flat."}
                                    """))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.fields[*].field", Matchers.hasItem("locality")));
        }
    }

    @Nested
    @DisplayName("a seeker post — nothing but prose, so nothing is foundation (D4)")
    class SeekerPosts {

        private String createPost(User author, String name, String note) throws Exception {
            return idIn(mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"%s","gender":"any","age":27,"occupation":"Analyst",
                                     "budget":18000,"localities":["EditTownG"],
                                     "moveIn":"2026-09-01","flatPref":"any","roomPref":"private",
                                     "tags":[],"note":"%s"}
                                    """.formatted(name, note)))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString());
        }

        @Test
        @DisplayName("rewriting the note on a published post reaches the desk")
        void aNewNoteIsRechecked() throws Exception {
            User author = host("9812000040", "Writer");
            User mod = admin("9812000041");
            String id = createPost(author, "Writer", "Quiet analyst, non-smoker.");

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"approved\"}"))
                    .andExpect(status().isOk());

            mvc.perform(patch(Routes.Flatmates.POST_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"Writer","gender":"any","age":27,
                                     "occupation":"Analyst","budget":18000,
                                     "localities":["EditTownG"],"moveIn":"2026-09-01",
                                     "flatPref":"any","roomPref":"private","tags":[],
                                     "note":"Call me on 98200 11223 for a quick chat."}
                                    """))
                    .andExpect(status().isOk());

            // Without a moderation hook on the write path a new note goes straight onto a
            // published post, and the free text is the entire reason the desk exists.
            recheckBoard(mod, "post")
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].recheckReason",
                            Matchers.contains("note")))
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].freeText",
                            Matchers.contains(Matchers.containsString("98200"))));
        }
    }

    @Nested
    @DisplayName("the verification queue is not a contact list either (D7)")
    class HostMobile {

        @Test
        @DisplayName("a tenant-tier host's number leaves the server masked")
        void theQueueMasksTheMobile() throws Exception {
            createRoom(host("9812000050", "Documented"),
                    roomBody("EditTownH", "Theta Place", "Private room", 15000,
                            "https://cdn.example/h1.jpg", "Sunny room."));

            mvc.perform(get(Routes.Moderation.FLATMATE_REVIEWS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9812000051"))))
                    .andExpect(status().isOk())
                    // The desk decides against the uploaded document and rings nobody, so twenty
                    // whole numbers a page was a bulk contact list earned for nothing.
                    .andExpect(jsonPath("$.content[*].hostMobile",
                            Matchers.everyItem(Matchers.matchesPattern("\\d{2}X{5}\\d{3}"))));
        }
    }

    /** The `recheckRequestedAt` this board reported for one row, read back out of its own JSON. */
    private static String stampOf(String queueJson, String id) {
        String afterId = queueJson.substring(queueJson.indexOf("\"id\":\"" + id + "\""));
        return afterId.replaceAll("(?s).*?\"recheckRequestedAt\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }
}
