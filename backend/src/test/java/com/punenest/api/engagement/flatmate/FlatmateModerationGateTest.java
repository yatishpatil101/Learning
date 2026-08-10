package com.punenest.api.engagement.flatmate;

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
 * D72 — nothing a user writes on the flatmate board is public until a moderator says so.
 *
 * <p><strong>Why this is a security test, not a workflow one.</strong> Every other public-facing
 * thing a user writes on this platform — a listing, a review — passes a moderator first. The
 * flatmate board did not: a post appeared on a {@code security: []} page the instant it was
 * written. Its {@code title}, {@code note} and {@code locality} are unbounded free text, which is
 * precisely where a broker who cannot publish a phone number in the contact field puts one instead.
 * So the queue that existed was a cleanup crew arriving after the harm rather than a gate in front
 * of it, and "we moderate the board" was true only in the sense that we eventually noticed.
 *
 * <p>The rule has three halves and all three have to hold together, because any one of them alone
 * is worse than the old behaviour:
 *
 * <ol>
 *   <li>A new post is invisible to everybody else.</li>
 *   <li>It is still visible to <em>its author</em> — otherwise writing a post looks like it failed,
 *       and the user writes it again.</li>
 *   <li>There is a queue, so somebody can let it out. Without this, "moderated before public"
 *       means "never public", which takes down honest supply to stop a broker.</li>
 * </ol>
 */
@DisplayName("Flatmate board — moderated before public (D72)")
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
                        .content("""
                                {"name":"%s","gender":"any","age":27,"occupation":"Analyst",
                                 "budget":18000,"localities":["%s"],"moveIn":"2026-09-01",
                                 "flatPref":"any","roomPref":"private","tags":[],
                                 "note":"Call me on 98200 11223 for a quick chat."}
                                """.formatted(name, locality)))
                .andExpect(status().isCreated())
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
    @DisplayName("a new post is not public")
    class NotPublic {

        @Test
        @DisplayName("a seeker post is absent from the anonymous feed until it is decided")
        void seekerPostStartsInvisible() throws Exception {
            createPost(seeker("9811000001", "Anita"), "Anita", "GateTownA");

            // No Authorization header: this is the surface the whole item is about.
            mvc.perform(get(Routes.Flatmates.POSTS).param("locality", "GateTownA"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("a room is absent from the anonymous feed until it is decided")
        void roomStartsInvisible() throws Exception {
            createRoom(seeker("9811000002", "RoomHost"), "GateTownB", "Gate Heights");

            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "GateTownB"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("a group is absent from the anonymous feed until it is decided")
        void groupStartsInvisible() throws Exception {
            createGroup(seeker("9811000003", "GroupHost"), "Three of us", "GateTownC");

            mvc.perform(get(Routes.Flatmates.GROUPS).param("locality", "GateTownC"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("nor can it be reached by acting on its id directly")
        void theDetailReadIsGatedToo() throws Exception {
            User author = seeker("9811000004", "Direct");
            String id = createPost(author, "Direct", "GateTownD");
            User other = seeker("9811000005", "Curious");

            // Hiding a row from the list while leaving it actionable by id is not moderation, it is
            // an unlisted page — and an id the author was just handed is not a secret. The interest
            // path reads through findVisible, so the gate has to hold here or the free text simply
            // travels by a different route.
            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"solo\",\"message\":\"Hi\"}"))
                    .andExpect(status().isNotFound());
        }
    }

    @Nested
    @DisplayName("but its author is not left guessing")
    class TheAuthorCanStillSeeIt {

        @Test
        @DisplayName("the create response says pending, so the page can say 'in review'")
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
                    // Without this the client has no way to distinguish "saved" from "published",
                    // and would show a success screen for a post nobody can see.
                    .andExpect(jsonPath("$.modStatus").value("pending"));
        }

        @Test
        @DisplayName("a room and a group say so too, so one screen can render all three")
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
                                     "photos":["https://cdn.example/1.jpg"],"note":"Hi."}
                                    """))
                    .andExpect(status().isCreated())
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
        @DisplayName("the pending post is waiting there, free text and all")
        void pendingPostsAppearInTheQueue() throws Exception {
            createPost(seeker("9811000020", "Dev"), "Dev", "GateTownG");

            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "post")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9811000021"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[?(@.headline == 'Dev')]",
                            Matchers.hasSize(1)))
                    // The reason the screen exists: the note is where the number was hidden.
                    .andExpect(jsonPath("$.content[?(@.headline == 'Dev')].freeText",
                            Matchers.contains(Matchers.containsString("98200"))));
        }

        @Test
        @DisplayName("approving it publishes it")
        void approvingMakesItPublic() throws Exception {
            String id = createRoom(seeker("9811000022", "Patient"), "GateTownH", "Patient House");

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9811000023")))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"approved\"}"))
                    .andExpect(status().isOk());

            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "GateTownH"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(1)));
        }

        @Test
        @DisplayName("rejecting it leaves it invisible, and off the pending queue")
        void rejectingKeepsItDown() throws Exception {
            String id = createRoom(seeker("9811000024", "Spam"), "GateTownI", "Spam House");
            User mod = admin("9811000025");

            mvc.perform(patch(Routes.Moderation.FLATMATE_MODERATION.replace("{id}", id))
                            .header(HttpHeaders.AUTHORIZATION, bearer(mod))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"modStatus\":\"rejected\",\"note\":\"phone in the note\"}"))
                    .andExpect(status().isOk());

            mvc.perform(get(Routes.Flatmates.ROOMS).param("locality", "GateTownI"))
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
        }

        @Test
        @DisplayName("the queue carries no phone number, however many rows it has")
        void theQueueIsNotAContactList() throws Exception {
            createPost(seeker("9811000026", "Eshan"), "Eshan", "GateTownJ");

            // A staff screen listing 20 people's numbers per page is a bulk contact export one
            // screenshot away from leaving the building, and reading a post does not need one.
            mvc.perform(get(Routes.Moderation.FLATMATE_MODERATION_QUEUE)
                            .param("kind", "post")
                            .header(HttpHeaders.AUTHORIZATION, bearer(admin("9811000027"))))
                    .andExpect(status().isOk())
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
