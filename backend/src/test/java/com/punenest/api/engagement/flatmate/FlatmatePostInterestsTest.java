package com.punenest.api.engagement.flatmate;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * "Who replied to my ad" — the poster-scoped read of one post's interests (D70).
 *
 * <p>The defect this closes was not a missing screen. The rows existed in {@code flatmate_requests}
 * the whole time; the only thing that ever showed them to the poster <em>for a particular ad</em>
 * was the notification the reply sent, and a notification is a delivery, not a record. Dismiss it
 * and the sender's name and number were gone from the poster's view while the row sat in the table.
 *
 * <p><strong>The load-bearing test here is {@link #anotherPostersAdIsNotReadable()}.</strong> Every
 * row on this endpoint is a stranger's name and phone number, and the id that selects them arrives
 * in the URL. If ownership is ever checked anywhere other than server-side on every call, this
 * endpoint becomes a contact-scraping tool addressed by guessing UUIDs. The other tests describe
 * what the feature is for; that one describes what it must never become.
 */
@DisplayName("Flatmates — the poster reads who answered their own ad")
class FlatmatePostInterestsTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    /** Audit writes run {@code REQUIRES_NEW} and escape this test's rollback. */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    // ---- fixtures ----

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    /**
     * A live, moderated ad. Published explicitly rather than by default (D72): a pending post is
     * invisible to the feed, and {@code express} refuses to answer what it cannot see — which would
     * make every test below fail for a reason that has nothing to do with what it is asserting.
     */
    private String livePost(User author, String name, String locality) throws Exception {
        String json = mvc.perform(post("/flatmates/posts")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"%s","gender":"any","budget":18000,
                                 "localities":["%s"],"note":"Quiet, tidy, work from home."}
                                """.formatted(name, locality)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = com.jayway.jsonpath.JsonPath.read(json, "$.id");
        jdbc.update("update flatmate_seeker_posts set mod_status = 'approved' where id = ?::uuid",
                id);
        return id;
    }

    private void answer(User requester, String postId, String message) throws Exception {
        mvc.perform(post("/flatmates/posts/" + postId + "/interest")
                        .header(HttpHeaders.AUTHORIZATION, bearer(requester))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"share\":\"solo\",\"message\":\"%s\"}".formatted(message)))
                .andExpect(status().isCreated());
    }

    private String interestsPath(String postId) {
        return "/flatmates/posts/" + postId + "/interests";
    }

    // ---- the read ----

    @Test
    @DisplayName("the poster gets every reply to their ad, newest first, with the contact that was volunteered")
    void posterReadsTheRepliesToTheirOwnAd() throws Exception {
        User poster = user("9821700001", "Anita Kulkarni");
        User first = user("9821700002", "Rhea Nair");
        User second = user("9821700003", "Tanvi Shah");
        String postId = livePost(poster, "Anita", "Baner");

        answer(first, postId, "I am moving to Baner next month.");
        answer(second, postId, "Interested — I work nearby.");

        mvc.perform(get(interestsPath(postId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(poster)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                // Newest first, matching the inbox: a poster working through replies meets the new
                // one, not the one they have already read.
                .andExpect(jsonPath("$.content[0].requesterName").value("Tanvi Shah"))
                .andExpect(jsonPath("$.content[1].requesterName").value("Rhea Nair"))
                // The number is the whole point of the row. It is the requester's own, handed over
                // by pressing "I'm interested" on this named post, and it is the same value the
                // host inbox already returns to this same caller for this same row.
                .andExpect(jsonPath("$.content[0].requesterMobile").value("9821700003"))
                .andExpect(jsonPath("$.content[1].requesterMobile").value("9821700002"))
                .andExpect(jsonPath("$.content[1].message")
                        .value("I am moving to Baner next month."))
                .andExpect(jsonPath("$.content[0].status").value("pending"))
                // Paged like the rest of the inbound-demand surface: the poster writes none of
                // these rows, so the list grows with how many people answered.
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20));
    }

    @Test
    @DisplayName("a stranger cannot read the replies to somebody else's ad by naming its id")
    void anotherPostersAdIsNotReadable() throws Exception {
        User poster = user("9821700011", "Anita Kulkarni");
        User responder = user("9821700012", "Rhea Nair");
        User stranger = user("9821700013", "Passing Stranger");
        String postId = livePost(poster, "Anita", "Baner");
        answer(responder, postId, "Interested.");

        // The id is public — this post is on the anonymous feed, and the stranger can read it there.
        // What is not public is who answered it. A real, verified account plus a known id must not
        // add up to a stranger's phone number, or the endpoint is a scraper with a URL.
        mvc.perform(get(interestsPath(postId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isForbidden());

        // Including for the person whose own number is in the row. They already know their number;
        // they have no business learning who else answered, and the check must not soften for
        // anyone who merely appears in the data.
        mvc.perform(get(interestsPath(postId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(responder)))
                .andExpect(status().isForbidden());

        // And not at all without a session. 401, not an empty page: an anonymous read that answers
        // 200 has already decided the question and only happens to have found nothing.
        mvc.perform(get(interestsPath(postId)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("the read is scoped to the ad, not to the poster's whole inbox")
    void repliesToOneAdDoNotLeakFromAnother() throws Exception {
        User poster = user("9821700021", "Anita Kulkarni");
        User answeredBaner = user("9821700022", "Meera Joshi");
        User answeredKothrud = user("9821700023", "Rhea Nair");

        // Two ads by the *same* poster, which is the only arrangement that can tell "scoped to this
        // ad" apart from "scoped to this caller". One live post per identity (D71), so the first
        // comes down before the second goes up — and coming down is not the same as going away.
        String baner = livePost(poster, "Anita", "Baner");
        answer(answeredBaner, baner, "Interested in Baner.");
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/flatmates/posts/" + baner)
                        .header(HttpHeaders.AUTHORIZATION, bearer(poster)))
                .andExpect(status().isNoContent());
        String kothrud = livePost(poster, "Anita", "Kothrud");
        answer(answeredKothrud, kothrud, "Interested in Kothrud.");

        // Both replies sit in this caller's inbox, so a read that widened to the inbox — or that
        // narrowed by host and forgot the ad — would answer 2 here and still look like a working
        // feature. It is the wrong two people to ring about this flat.
        mvc.perform(get(interestsPath(baner)).header(HttpHeaders.AUTHORIZATION, bearer(poster)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].requesterName").value("Meera Joshi"))
                .andExpect(jsonPath("$.content[0].requesterMobile").value("9821700022"));

        mvc.perform(get(interestsPath(kothrud)).header(HttpHeaders.AUTHORIZATION, bearer(poster)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].requesterName").value("Rhea Nair"))
                .andExpect(jsonPath("$.content[0].requesterMobile").value("9821700023"));
    }

    @Test
    @DisplayName("taking the ad down does not take the leads down with it")
    void archivedPostStillListsItsReplies() throws Exception {
        User poster = user("9821700031", "Anita Kulkarni");
        User responder = user("9821700032", "Rhea Nair");
        String postId = livePost(poster, "Anita", "Baner");
        answer(responder, postId, "Interested.");

        // "Mark filled" and "Delete" are the same operation, and both archive the post.
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/flatmates/posts/" + postId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(poster)))
                .andExpect(status().isNoContent());

        // The people who answered while it was live are precisely the leads the poster still needs
        // — a flat gets filled *from* this list. Reading it through `findVisible` would have
        // reinstated the defect one step later: the record vanishes the moment it becomes useful.
        mvc.perform(get(interestsPath(postId))
                        .header(HttpHeaders.AUTHORIZATION, bearer(poster)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].requesterMobile").value("9821700032"));
    }
}
