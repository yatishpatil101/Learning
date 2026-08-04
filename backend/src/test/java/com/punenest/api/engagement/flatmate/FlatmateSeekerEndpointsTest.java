package com.punenest.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
 * Contract and behaviour proof for flatmate seeker posts and the host inbox.
 *
 * <p>These replace {@code ShareFlatEndpointsTest}, retired with its controller in V28. The
 * invariants it protected are the same ones that matter here, because the contact model is
 * unchanged — it is still the one surface on the platform where contact travels opposite to
 * everywhere else:
 *
 * <ol>
 *   <li><strong>The public feed publishes no contact at all.</strong> Not masked — absent. There is
 *       no caller to gate against on an anonymous endpoint, so a masked number there is just a
 *       published number with five digits removed.</li>
 *   <li><strong>Expressing interest releases the <em>requester's</em> number to the host.</strong>
 *       Pressing the button is the affirmative act the gate exists to require, and it is the
 *       requester's own number they are handing over.</li>
 *   <li><strong>Nothing flows back.</strong> The host's number is never revealed by the reply.</li>
 *   <li><strong>Resending edits rather than re-notifies</strong>, because a button that alerts
 *       somebody else's phone on every press is a harassment tool.</li>
 * </ol>
 */
@DisplayName("Flatmates — seeker posts, and the contact that moves across them")
class FlatmateSeekerEndpointsTest extends AbstractApiTest {

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

    private static String body(String name, String locality) {
        return """
                {"name":"%s","gender":"female","age":26,"occupation":"UX Designer",
                 "budget":18000,"localities":["%s"],"moveIn":"2026-09-01",
                 "flatPref":"women","roomPref":"private","tags":["Vegetarian"],
                 "note":"Quiet, tidy, work from home twice a week."}
                """.formatted(name, locality);
    }

    private String createPost(User author, String name, String locality) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(name, locality)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
    }

    @Nested
    @DisplayName("the feed")
    class Feed {

        @Test
        @DisplayName("is public, and publishes no phone number for anyone")
        void feedIsAnonymousAndCarriesNoContact() throws Exception {
            User author = user("9810000001", "Anita");
            createPost(author, "Anita", "Baner");

            // No Authorization header at all: this is the anonymous surface.
            mvc.perform(get(Routes.Flatmates.POSTS).param("locality", "Baner"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content[0].name").value("Anita"))
                    // The whole point of S62, carried forward: absent, not masked.
                    .andExpect(jsonPath("$.content[0].mobile").doesNotExist());
        }

        @Test
        @DisplayName("filters on a locality the seeker actually listed")
        void localityFilterMatchesTheShortlist() throws Exception {
            User author = user("9810000002", "Bhavna");
            createPost(author, "Bhavna", "Kothrud");

            mvc.perform(get(Routes.Flatmates.POSTS).param("locality", "Kothrud"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(Matchers.greaterThan(0))));

            mvc.perform(get(Routes.Flatmates.POSTS).param("locality", "Wakad"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }

        @Test
        @DisplayName("hides a post a moderator flagged, rather than relabelling it")
        void moderationRemovesFromFeed() throws Exception {
            User author = user("9810000003", "Chitra");
            String id = createPost(author, "Chitra", "Aundh");

            jdbc.update("update flatmate_seeker_posts set mod_status = 'flagged' where id = ?::uuid", id);

            mvc.perform(get(Routes.Flatmates.POSTS).param("locality", "Aundh"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content", Matchers.hasSize(0)));
        }
    }

    @Nested
    @DisplayName("posting")
    class Posting {

        @Test
        @DisplayName("one live post per identity; a second is refused")
        void oneLivePostPerIdentity() throws Exception {
            User author = user("9810000010", "Deepa");
            createPost(author, "Deepa", "Baner");

            mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body("Deepa", "Baner")))
                    .andExpect(status().isConflict());
        }

        @Test
        @DisplayName("taking one down frees the slot")
        void archivingFreesTheSlot() throws Exception {
            User author = user("9810000011", "Esha");
            String id = createPost(author, "Esha", "Baner");

            mvc.perform(delete(Routes.Flatmates.POST_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                    .andExpect(status().isNoContent());

            mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body("Esha", "Baner")))
                    .andExpect(status().isCreated());
        }

        @Test
        @DisplayName("staff may not advertise themselves as a flatmate")
        void staffCannotPost() throws Exception {
            User staff = user("9810000012", "Ops", Roles.Wire.STAFF);

            mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body("Ops", "Baner")))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("editing someone else's post is refused")
        void cannotEditAnothersPost() throws Exception {
            User author = user("9810000013", "Farah");
            User other = user("9810000014", "Gita");
            String id = createPost(author, "Farah", "Baner");

            mvc.perform(patch(Routes.Flatmates.POST_BY_ID, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(other))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body("Gita", "Baner")))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("an unknown enum value names the field and lists what was expected")
        void badVocabularyIsA400NamingTheField() throws Exception {
            User author = user("9810000015", "Hema");

            mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"Hema","gender":"unspecified","budget":18000,
                                     "localities":["Baner"]}
                                    """))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message", Matchers.containsString("gender")));
        }
    }

    @Nested
    @DisplayName("expressing interest")
    class Interest {

        @Test
        @DisplayName("hands the requester's own number to the host, and nothing back")
        void interestReleasesTheSendersNumberOnly() throws Exception {
            User host = user("9810000020", "Isha");
            User requester = user("9810000021", "Jay");
            String id = createPost(host, "Isha", "Baner");

            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"share":"solo","message":"Hi! I'd like to team up."}
                                    """))
                    .andExpect(status().isCreated());

            // The host's notification carries the REQUESTER's number...
            String body = jdbc.queryForObject(
                    "select body from notifications where user_id = ?::uuid",
                    String.class, host.getId().toString());
            assertThat(body).contains("9810000021");

            // ...and the requester is told nothing about the host's.
            Integer toRequester = jdbc.queryForObject(
                    "select count(*) from notifications where user_id = ?::uuid",
                    Integer.class, requester.getId().toString());
            assertThat(toRequester).isZero();
        }

        @Test
        @DisplayName("resending edits the pitch and does not notify a second time")
        void resendIsIdempotent() throws Exception {
            User host = user("9810000022", "Kiran");
            User requester = user("9810000023", "Lata");
            String id = createPost(host, "Kiran", "Baner");

            for (String message : List.of("First try.", "Better pitch.")) {
                mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                                .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"message\":\"" + message + "\"}"))
                        .andExpect(status().isCreated());
            }

            Integer requests = jdbc.queryForObject(
                    "select count(*) from flatmate_requests where target_id = ?::uuid", Integer.class, id);
            assertThat(requests).isOne();

            Integer notifications = jdbc.queryForObject(
                    "select count(*) from notifications where user_id = ?::uuid",
                    Integer.class, host.getId().toString());
            assertThat(notifications).isOne();

            String stored = jdbc.queryForObject(
                    "select message from flatmate_requests where target_id = ?::uuid",
                    String.class, id);
            assertThat(stored).isEqualTo("Better pitch.");
        }

        @Test
        @DisplayName("you cannot answer your own ad")
        void cannotAnswerYourOwnPost() throws Exception {
            User author = user("9810000024", "Manoj");
            String id = createPost(author, "Manoj", "Baner");

            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(author))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"message\":\"hello me\"}"))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("a verified-contact-only seeker refuses an unbadged caller (ADR-019)")
        void verifiedContactOnlyIsHonoured() throws Exception {
            User host = user("9810000025", "Neha");
            User requester = user("9810000026", "Omkar");

            // Set through the API rather than by raw SQL: a JDBC update is invisible to the
            // persistence context this test shares with the service, so the service would read a
            // stale entity. Going through the real write path is the honester test regardless.
            String json = mvc.perform(post(Routes.Flatmates.POSTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"Neha","budget":18000,"localities":["Baner"],
                                     "verifiedContactOnly":true}
                                    """))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.verifiedContactOnly").value(true))
                    .andReturn().getResponse().getContentAsString();
            String id = json.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");

            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"message\":\"Hi!\"}"))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error").value("verification_required"));
        }

        @Test
        @DisplayName("an absent message becomes an opener that matches the share intent")
        void absentMessageBecomesAnOpener() throws Exception {
            User host = user("9810000027", "Pooja");
            User requester = user("9810000028", "Quasim");
            String id = createPost(host, "Pooja", "Baner");

            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"share\":\"bring\"}"))
                    .andExpect(status().isCreated());

            String stored = jdbc.queryForObject(
                    "select message from flatmate_requests where target_id = ?::uuid",
                    String.class, id);
            assertThat(stored).contains("two of us");
        }
    }

    @Nested
    @DisplayName("the host inbox")
    class Inbox {

        @Test
        @DisplayName("shows who answered, with their number, so the host can act")
        void inboxCarriesTheRequesterContact() throws Exception {
            User host = user("9810000030", "Rhea");
            User requester = user("9810000031", "Sameer");
            String id = createPost(host, "Rhea", "Baner");

            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"message\":\"Hi!\"}"))
                    .andExpect(status().isCreated());

            mvc.perform(get(Routes.Flatmates.MY_REQUESTS)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].requesterName").value("Sameer"))
                    .andExpect(jsonPath("$[0].requesterMobile").value("9810000031"))
                    .andExpect(jsonPath("$[0].status").value("pending"));
        }

        @Test
        @DisplayName("accepting records the decision and tells the requester")
        void acceptingNotifiesTheRequester() throws Exception {
            User host = user("9810000032", "Tara");
            User requester = user("9810000033", "Umesh");
            String id = createPost(host, "Tara", "Baner");

            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"message\":\"Hi!\"}"))
                    .andExpect(status().isCreated());

            String requestId = jdbc.queryForObject(
                    "select id::text from flatmate_requests where target_id = ?::uuid",
                    String.class, id);

            mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, requestId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(host))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"accepted\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value("accepted"))
                    .andExpect(jsonPath("$.decidedAt").isNotEmpty());

            Integer told = jdbc.queryForObject(
                    "select count(*) from notifications where user_id = ?::uuid",
                    Integer.class, requester.getId().toString());
            assertThat(told).isOne();
        }

        @Test
        @DisplayName("deciding another host's request is a 404, not a 403")
        void decidingSomebodyElsesRequestIsNotFound() throws Exception {
            User host = user("9810000034", "Vidya");
            User requester = user("9810000035", "Wasim");
            User stranger = user("9810000036", "Xena");
            String id = createPost(host, "Vidya", "Baner");

            mvc.perform(post(Routes.Flatmates.POST_INTEREST, id)
                            .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"message\":\"Hi!\"}"))
                    .andExpect(status().isCreated());

            String requestId = jdbc.queryForObject(
                    "select id::text from flatmate_requests where target_id = ?::uuid",
                    String.class, id);

            // 404 rather than 403: a 403 would confirm the id exists and belongs to another host.
            mvc.perform(patch(Routes.Flatmates.MY_REQUEST_BY_ID, requestId)
                            .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"decision\":\"accepted\"}"))
                    .andExpect(status().isNotFound());
        }
    }
}
