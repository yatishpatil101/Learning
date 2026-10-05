package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
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

// Broker contact can hide in unbounded title, note or locality text.
// All three gates must hold; any one alone either hides or leaks the post.
@DisplayName("Flatmate board — a flat is moderated before public, a flatless post after (D72)")
class FlatmateModerationGateTest extends AbstractApiTest {

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

    private User seeker(String mobile, String name) {
        return user(mobile, name, Roles.Wire.BUYER);
    }

    private static String idIn(String json) {
        return json.replaceAll(".*?\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    private String createPost(User author, String name, String locality) throws Exception {
        return idIn(mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(postBody(name, locality, "Quiet, early riser.")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private static String postBody(String name, String locality, String note) {
        return """
                {"name":"%s","gender":"any","age":27,"occupation":"Analyst",
                 "budget":18000,"localities":["%s"],"moveIn":"2026-09-01",
                 "flatPref":"any","roomPref":"private","tags":[],"note":"%s"}
                """.formatted(name, locality, note);
    }

    private String createHuntingGroup(User host, String locality) throws Exception {
        return idIn(mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"Three of us, hunting","policy":"any","seats":3,"seatsOpen":1,
                                 "name":"Host","tags":[],
                                 "preferences":{"localities":["%s"],"bhk":["2"],"rentMin":30000,
                                   "rentMax":45000,"gatedOnly":false,"bachelors":false}}
                                """.formatted(locality)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.modStatus").value("live"))
                .andReturn().getResponse().getContentAsString());
    }

    private String createRoom(User host, String locality, String society) throws Exception {
        return idIn(mvc.perform(post(Routes.Flatmates.ROOMS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                 "furnishing":"semi","locality":"%s","society":"%s",
                                 "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                                 "lookingFor":"any","foodPref":"any",
                                 "photos":["https://cdn.example/1.jpg"],
                                 "hostRole":"owner",
                                 "note":"Sunny room."}
                                """.formatted(locality, society)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    private String createGroup(User host, String title, String locality) throws Exception {
        return idIn(mvc.perform(post(Routes.Flatmates.GROUPS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(host))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"title":"%s","locality":"%s","policy":"any","rent":40000,
                                 "seats":3,"seatsOpen":1,"name":"Host","tags":[]}
                                """.formatted(title, locality)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
    }

    @Nested
    @DisplayName("a post with a flat is not public")
    class NotPublic {

            // No Authorization header: this is the surface the whole item is about.
        @Test
        @DisplayName("a room is absent from the anonymous feed until it is decided")
        void roomStartsInvisible() throws Exception {
            createRoom(seeker("9811000002", "RoomHost"), "GateTownB", "Gate Heights");

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "GateTownB"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("a group with a flat is absent from the anonymous feed until it is decided")
        void groupStartsInvisible() throws Exception {
            createGroup(seeker("9811000003", "GroupHost"), "Three of us", "GateTownC");

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up").param("locality", "GateTownC"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("nor can it be reached by acting on its id directly")
        void theDetailReadIsGatedToo() throws Exception {
            String id = createRoom(seeker("9811000004", "Direct"), "GateTownD", "Direct House");
            User other = seeker("9811000005", "Curious");

            // The interest path uses `findVisible`; otherwise free text leaks by another route.
            mvc.perform(post(Routes.Flatmates.ROOM_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\",\"message\":\"Hi\"}"))
                    .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("a post with no flat is public at once, but cannot carry a number")
    class FlatlessGoesLive {

        @Test
        @DisplayName("a seeker post is on the anonymous feed as soon as it is written")
        void seekerPostIsPublic() throws Exception {
            createPost(seeker("9811000001", "Anita"), "Anita", "GateTownA");

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up").param("locality", "GateTownA"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("a hunting group is on the team-up tab as soon as it is written")
        void huntingGroupIsPublic() throws Exception {
            String id = createHuntingGroup(seeker("9811000006", "Hunter"), "GateTownK");

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up")
                            .param("locality", "GateTownK"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[*].id", Matchers.contains(id)));
        }

        @Test
        @DisplayName("a phone number in the free text is refused at the door, not published")
        void aNumberIsRefused() throws Exception {
            mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(seeker("9811000007", "Broker")))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(postBody("Broker", "GateTownL", "Call me on 98200 11223.")))
                    .andExpect(status().isUnprocessableEntity());

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up").param("locality", "GateTownL"))
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }
    }

    @Nested
    @DisplayName("and its author is not left guessing")
    class TheAuthorCanStillSeeIt {

        @Test
        @DisplayName("the create response says live, so the page can say so")
        void createEchoesTheModerationState() throws Exception {
            User author = seeker("9811000010", "Bhavna");

            mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"Bhavna","gender":"any","age":27,"budget":18000,
                                     "localities":["GateTownE"],"moveIn":"2026-09-01",
                                     "flatPref":"any","roomPref":"private","tags":[],"note":"Hi."}
                                    """))
                    .andExpect(status().isCreated())

                    .andExpect(jsonPath("$.modStatus").value("live"));
        }

        @Test
        @DisplayName("a room says pending, so the page can say 'in review'")
        void supplyEchoesTheModerationStateAsWell() throws Exception {
            User host = seeker("9811000011", "Chitra");

            mvc.perform(post(Routes.Flatmates.ROOMS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"bhk":"2","roomType":"Private room","attachedBath":"attached",
                                     "furnishing":"semi","locality":"GateTownF","society":"Ch House",
                                     "rentShare":15000,"deposit":30000,"availableFrom":"2026-09-01",
                                     "lookingFor":"any","foodPref":"any",
                                     "photos":["https://cdn.example/1.jpg"],"hostRole":"owner","note":"Hi."}
                                    """))
                    .andExpect(status().isCreated())
                    // Without this the client has no way to distinguish "saved" from "published",
                    // and would show a success screen for a post nobody can see.
                    .andExpect(jsonPath("$.modStatus").value("pending"));
        }
    }

    @Nested
    @DisplayName("and there is a queue to let it out")
    class TheQueue {

        private User admin(String mobile) {
            return user(mobile, "Mod", Roles.Wire.ADMIN);
        }

        @Test
        @DisplayName("a self-published post waits on the re-check board, marked as never read")
        void selfPublishedPostsAppearOnTheRecheckBoard() throws Exception {
            createPost(seeker("9811000020", "Dev"), "Dev", "GateTownG");

            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "post").param("modStatus", "recheck")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9811000021"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.headline == 'Dev')].recheckReason",
                            Matchers.contains(FlatmatePublication.UNREVIEWED)));
        }

        @Test
        @DisplayName("approving it publishes it, and tells the host with a link to it")
        void approvingMakesItPublic() throws Exception {
            User host = seeker("9811000022", "Patient");
            String id = createRoom(host, "GateTownH", "Patient House");

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9811000023")))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"approved\"}"))
                    .andExpect(status().isOk());

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "GateTownH"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));

            assertThat(jdbc.queryForList(
                    "select link from notifications where user_id = ?::uuid "
                            + "and type = 'flatmate.moderated.live'",
                    String.class, host.getId().toString()))
                    .containsExactly("/flatmates/room/" + id);
        }

        @Test
        @DisplayName("rejecting it leaves it invisible, off the pending queue, and the host told")
        void rejectingKeepsItDown() throws Exception {
            User host = seeker("9811000024", "Spam");
            String id = createRoom(host, "GateTownI", "Spam House");
            User mod = admin("9811000025");

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"rejected\",\"note\":\"phone in the note\"}"))
                    .andExpect(status().isOk());

            mvc.perform(get(Routes.Flatmates.FEED).param("tab", "move-in").param("locality", "GateTownI"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));

            // A decided post must leave the queue, or the backlog never shrinks and the moderator
            // re-reads the same rejection every morning.
            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "room")
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.id == '" + id + "')]",
                            Matchers.hasSize(0)));

            assertThat(jdbc.queryForList(
                    "select type from notifications where user_id = ?::uuid "
                            + "and type like 'flatmate.moderated.%'",
                    String.class, host.getId().toString()))
                    .containsExactly("flatmate.moderated.rejected");
        }

        @Test
        @DisplayName("the queue carries no phone number, however many rows it has")
        void theQueueIsNotAContactList() throws Exception {
            createPost(seeker("9811000026", "Eshan"), "Eshan", "GateTownJ");

            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "post").param("modStatus", "recheck")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9811000027"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].id").exists())
                    .andExpect(jsonPath("$.content[0].mobile").doesNotExist())
                    .andExpect(jsonPath("$.content[0].authorMobile").doesNotExist());
        }

        @Test
        @DisplayName("it is staff-only — a buyer cannot read the board of unpublished posts")
        void theQueueIsNotPublic() throws Exception {
            User nosy = seeker("9811000028", "Nosy");

            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "post")
                            .header(HttpHeaders.AUTHORIZATION, bearer(nosy)))
                    .andExpect(status().isForbidden());
        }
    }
}
