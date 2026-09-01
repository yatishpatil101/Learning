package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * D240 slice 3 — the society hub's community tab.
 *
 * <p>Every tip, every recommended electrician and every photo of the actual lobby lived in
 * {@code dzSocietyContributions} in the author's own browser. The "community" tab showed each
 * visitor a community of exactly one person: themselves. The single most valuable thing on the page
 * — a neighbour's number for a plumber who turns up — was only ever visible to the person who
 * already had it.
 *
 * <p>What is asserted here is what a browser-local version could not be:
 *
 * <ol>
 *   <li><strong>A contribution is readable without an account</strong>, because the tips are most
 *       of what a stranger comes to a society page for — but a recommended person's
 *       <strong>phone number is withheld</strong> from that anonymous read. They never agreed to be
 *       on the open web.</li>
 *   <li><strong>A helpful vote is idempotent.</strong> {@code PUT} twice is one vote, not two, and
 *       not one-then-zero. That is the entire reason it is not a toggle.</li>
 *   <li><strong>Each kind carries its own minimum</strong>, and fields belonging to another kind
 *       are dropped rather than stored — a phone number on a row no screen renders it on is a
 *       number nobody can ask to have removed.</li>
 *   <li><strong>The list is ordered by helpfulness, then recency</strong>, so the tip the building
 *       actually endorses is the first one a stranger reads.</li>
 *   <li><strong>Removing a contribution takes its thread with it</strong>; replies to something
 *       invisible are answers to a question the reader cannot see.</li>
 *   <li><strong>Only the author, the committee or staff may remove</strong> — a neighbour, equally
 *       resident, may not. Residency buys the right to contribute, not to moderate.</li>
 * </ol>
 */
@DisplayName("Societies — the community tab")
class SocietyContributionTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * Needed only to make a JPA delete visible to the raw SQL in {@link #removalCascades()}.
     *
     * <p>The test method and the request it makes share one transaction, so Hibernate is free to
     * hold the delete until commit — which never comes, because the class rolls back. Without a
     * flush the {@code count(*)} below reads the world as it was before the delete and the
     * assertion fails while the cascade works perfectly.
     */
    @PersistenceContext EntityManager em;

    /**
     * Mobile block 98640000xx — used by no other test class.
     *
     * <p>Nothing here provisions an account through a {@code REQUIRES_NEW} path, so the class-level
     * rollback takes these rows back out and no {@code @AfterAll} cleanup is needed.
     */
    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String staff(String mobile) {
        User u = new User(mobile, Roles.Wire.STAFF);
        u.setName("Ops " + mobile.substring(6));
        u.setMobileVerified(true);
        return "Bearer " + jwtService.issueAccessToken(users.saveAndFlush(u));
    }

    /**
     * A seeded society by position, not by name — seed display names are not unique.
     *
     * <p>{@code source <> 'community'} is what keeps the position meaningful. Every mint in the
     * suite inserts a row into the same table, so an unfiltered {@code offset} names a different
     * society depending on how many societies the classes that ran first happened to add — and two
     * classes that then land on one slug read each other's rows. The symptom is not a failure at
     * the mint; it is this class asserting on somebody else's tip, intermittently, with the order
     * of the whole suite as the hidden input.
     */
    private String society(int offset) {
        List<String> slugs = jdbc.queryForList(
                "select slug from societies where source <> 'community' order by slug offset ? limit 1",
                String.class, offset);
        assertThat(slugs).as("a seeded society at offset " + offset).hasSize(1);
        return slugs.get(0);
    }

    private String idOf(ResultActions r) throws Exception {
        String json = r.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"id\":\"") + 6;
        return json.substring(at, json.indexOf('"', at));
    }

    private ResultActions add(User u, String slug, String json) throws Exception {
        return mvc.perform(post("/societies/" + slug + "/contributions")
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    private String tip(User u, String slug, String body) throws Exception {
        return idOf(add(u, slug, "{\"kind\":\"tip\",\"body\":\"" + body + "\"}")
                .andExpect(status().isCreated()));
    }

    /* ------------------------------------------------------------- the read */

    @Test
    @DisplayName("a tip is readable with no account at all — that is the point of the page")
    void publicRead() throws Exception {
        String slug = society(0);
        User author = user("9864000001", "Ishita Rane");
        tip(author, slug, "The back gate is quicker before 9am.");

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].body").value("The back gate is quicker before 9am."))
                .andExpect(jsonPath("$.content[0].authorName").value("Ishita Rane"))
                .andExpect(jsonPath("$.content[0].helpfulCount").value(0))
                .andExpect(jsonPath("$.content[0].helpfulByMe").value(false))
                // A reader with no account has nothing to remove, so no control is drawn for them.
                .andExpect(jsonPath("$.content[0].canRemove").value(false));
    }

    @Test
    @DisplayName("a recommended person's number is withheld from a reader with no account")
    void referralContactIsGated() throws Exception {
        String slug = society(1);
        User author = user("9864000002", "Rohit Sane");
        add(author, slug, "{\"kind\":\"pick\",\"referralName\":\"Vishal the electrician\","
                + "\"referralContact\":\"9822001122\",\"body\":\"Same day, fair rates.\"}")
                .andExpect(status().isCreated());

        // The plumber never agreed to appear on the open web. Everything else about the
        // recommendation stays visible, so the card still reads as a recommendation.
        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].referralName").value("Vishal the electrician"))
                .andExpect(jsonPath("$.content[0].referralContact").doesNotExist());

        User neighbour = user("9864000003", "Sneha Kale");
        mvc.perform(get("/societies/" + slug + "/contributions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(neighbour)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].referralContact").value("9822001122"));
    }

    @Test
    @DisplayName("the resident badge is recomputed on every read, not frozen at posting time")
    void badgeIsLive() throws Exception {
        String slug = society(2);
        String ops = staff("9864000004");
        User author = user("9864000005", "Aarti Bhosale");

        String residentId = idOf(mvc.perform(post("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flat\":\"C-101\",\"relation\":\"owner\"}"))
                .andExpect(status().isOk()));
        mvc.perform(patch("/societies/" + slug + "/residents/" + residentId)
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"verified\"}"))
                .andExpect(status().isOk());

        tip(author, slug, "Water pressure is best on the lower floors.");
        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(jsonPath("$.content[0].authorIsResident").value(true));

        // The committee changes its mind. A stored flag would keep vouching for them.
        mvc.perform(patch("/societies/" + slug + "/residents/" + residentId)
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(jsonPath("$.content[0].authorIsResident").value(false));
    }

    /* ------------------------------------------------------------ the write */

    @Test
    @DisplayName("each kind has its own minimum, and an unknown kind is refused")
    void kindShape() throws Exception {
        String slug = society(3);
        User u = user("9864000006", "Kunal Deo");

        add(u, slug, "{\"kind\":\"tip\"}").andExpect(status().isBadRequest());
        add(u, slug, "{\"kind\":\"tip\",\"body\":\"   \"}").andExpect(status().isBadRequest());
        add(u, slug, "{\"kind\":\"pick\",\"body\":\"Great chap\"}").andExpect(status().isBadRequest());
        add(u, slug, "{\"kind\":\"photo\",\"body\":\"The lobby\"}").andExpect(status().isBadRequest());
        add(u, slug, "{\"kind\":\"rumour\",\"body\":\"I heard something\"}")
                .andExpect(status().isBadRequest());

        add(u, slug, "{\"kind\":\"photo\",\"photoUrl\":\"https://cdn.example/lobby.jpg\","
                + "\"body\":\"The lobby at 7am\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.photoUrl").value("https://cdn.example/lobby.jpg"));
    }

    @Test
    @DisplayName("a phone number sent on a tip is dropped, not stored on a card that never shows it")
    void foreignFieldsAreDropped() throws Exception {
        String slug = society(4);
        User u = user("9864000007", "Prachi Naik");

        // The composer does not draw these fields for a tip, so a 400 would point at something the
        // author cannot see. Dropping them keeps a stray contact detail out of a row that offers
        // nobody a way to delete it.
        add(u, slug, "{\"kind\":\"tip\",\"body\":\"Park on the left.\","
                + "\"referralName\":\"Someone\",\"referralContact\":\"9822009988\","
                + "\"photoUrl\":\"https://cdn.example/x.jpg\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.referralName").doesNotExist())
                .andExpect(jsonPath("$.referralContact").doesNotExist())
                .andExpect(jsonPath("$.photoUrl").doesNotExist());
    }

    @Test
    @DisplayName("writing needs an account; reading does not")
    void writesRequireAuth() throws Exception {
        String slug = society(5);
        mvc.perform(post("/societies/" + slug + "/contributions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"tip\",\"body\":\"Hello\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/societies/" + slug + "/contributions")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("an unknown society is a 404, not an empty list")
    void unknownSociety() throws Exception {
        mvc.perform(get("/societies/no-such-society-anywhere/contributions"))
                .andExpect(status().isNotFound());
    }

    /* --------------------------------------------------------------- voting */

    @Test
    @DisplayName("marking helpful twice is one vote — the whole reason it is not a toggle")
    void helpfulIsIdempotent() throws Exception {
        String slug = society(6);
        User author = user("9864000008", "Yash Pawar");
        User voter = user("9864000009", "Neha Salvi");
        String id = tip(author, slug, "Lift B is the fast one.");

        String url = "/societies/" + slug + "/contributions/" + id + "/helpful";
        mvc.perform(put(url).header(HttpHeaders.AUTHORIZATION, bearer(voter)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.helpfulCount").value(1))
                .andExpect(jsonPath("$.helpfulByMe").value(true));

        // A retry after a timeout on a train. A toggle would silently undo the vote it just cast.
        mvc.perform(put(url).header(HttpHeaders.AUTHORIZATION, bearer(voter)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.helpfulCount").value(1))
                .andExpect(jsonPath("$.helpfulByMe").value(true));

        mvc.perform(delete(url).header(HttpHeaders.AUTHORIZATION, bearer(voter)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.helpfulCount").value(0))
                .andExpect(jsonPath("$.helpfulByMe").value(false));

        // Withdrawing a vote you never cast is also a no-op, for the same reason.
        mvc.perform(delete(url).header(HttpHeaders.AUTHORIZATION, bearer(voter)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.helpfulCount").value(0));
    }

    @Test
    @DisplayName("helpfulByMe is per reader, and the count is everyone")
    void helpfulIsPerReader() throws Exception {
        String slug = society(7);
        User author = user("9864000010", "Devang Shah");
        User one = user("9864000011", "Ritu Bane");
        User two = user("9864000012", "Sameer Wagh");
        String id = tip(author, slug, "The society gym key is with the guard.");
        String url = "/societies/" + slug + "/contributions/" + id + "/helpful";

        mvc.perform(put(url).header(HttpHeaders.AUTHORIZATION, bearer(one))).andExpect(status().isOk());
        mvc.perform(put(url).header(HttpHeaders.AUTHORIZATION, bearer(two))).andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/contributions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(one)))
                .andExpect(jsonPath("$.content[0].helpfulCount").value(2))
                .andExpect(jsonPath("$.content[0].helpfulByMe").value(true));

        mvc.perform(get("/societies/" + slug + "/contributions")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(jsonPath("$.content[0].helpfulCount").value(2))
                .andExpect(jsonPath("$.content[0].helpfulByMe").value(false));
    }

    @Test
    @DisplayName("the most helpful tip outranks the newest one")
    void helpfulnessBeatsRecency() throws Exception {
        String slug = society(8);
        User author = user("9864000013", "Manasi Kar");
        User voter = user("9864000014", "Aniket Sule");

        String older = tip(author, slug, "Older but useful.");
        String newer = tip(author, slug, "Newer and unvoted.");

        // Back-dated rather than left to the clock. created_at comes from @CreationTimestamp — a
        // JVM clock read, not the database — so two tips posted back-to-back can share an instant.
        // The ordering then falls through c.createdAt desc to the c.id desc tie-break, which is a
        // random UUID, and "the older one" wins about half the time. That is not hypothetical: it
        // is how this assertion failed in a full-suite run while passing every run in isolation,
        // because a warmed JVM does both POSTs inside one clock tick (15 tests in 0.5s hot against
        // 22s cold). Making the row genuinely older tests the ordering rule instead of the clock.
        em.flush();
        jdbc.update("update society_contributions set created_at = created_at - interval '1 minute'"
                + " where id = ?::uuid", older);

        // Newest-first until somebody weighs in.
        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(jsonPath("$.content[0].id").value(newer));

        mvc.perform(put("/societies/" + slug + "/contributions/" + older + "/helpful")
                        .header(HttpHeaders.AUTHORIZATION, bearer(voter)))
                .andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(jsonPath("$.content[0].id").value(older))
                .andExpect(jsonPath("$.content[1].id").value(newer));
    }

    /* -------------------------------------------------------------- replies */

    @Test
    @DisplayName("a reply appears in the thread and its author can take it back")
    void replyRoundTrip() throws Exception {
        String slug = society(9);
        User author = user("9864000015", "Tejas More");
        User replier = user("9864000016", "Pooja Gaikwad");
        String id = tip(author, slug, "The society has a shared drill.");

        String replyId = idOf(mvc.perform(post("/societies/" + slug + "/contributions/" + id + "/replies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(replier))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"Who holds it?\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorName").value("Pooja Gaikwad")));

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(jsonPath("$.content[0].replies[0].body").value("Who holds it?"));

        // The tip's author does not own the conversation about it — only their own words in it.
        mvc.perform(delete("/societies/" + slug + "/contributions/" + id + "/replies/" + replyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isForbidden());

        mvc.perform(delete("/societies/" + slug + "/contributions/" + id + "/replies/" + replyId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(replier)))
                .andExpect(status().isNoContent());

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(jsonPath("$.content[0].replies").isEmpty());
    }

    @Test
    @DisplayName("an empty reply is refused")
    void blankReplyRejected() throws Exception {
        String slug = society(10);
        User u = user("9864000017", "Harsh Jadhav");
        String id = tip(u, slug, "Recycling goes out on Fridays.");

        // 422, not 400: this one is caught by `@NotBlank` on the request record before the handler
        // runs, and the API's bean-validation failures are unprocessable-entity throughout.
        mvc.perform(post("/societies/" + slug + "/contributions/" + id + "/replies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"   \"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    /* -------------------------------------------------------------- removal */

    @Test
    @DisplayName("a neighbour cannot remove your tip; you and staff can")
    void removalRules() throws Exception {
        String slug = society(11);
        User author = user("9864000018", "Sagar Kadam");
        User neighbour = user("9864000019", "Isha Phadke");
        String ops = staff("9864000020");

        String mine = tip(author, slug, "Visitor parking fills by 8pm.");
        mvc.perform(delete("/societies/" + slug + "/contributions/" + mine)
                        .header(HttpHeaders.AUTHORIZATION, bearer(neighbour)))
                .andExpect(status().isForbidden());
        mvc.perform(delete("/societies/" + slug + "/contributions/" + mine)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isNoContent());

        String theirs = tip(neighbour, slug, "The terrace is open till 10.");
        mvc.perform(delete("/societies/" + slug + "/contributions/" + theirs)
                        .header(HttpHeaders.AUTHORIZATION, ops))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("removing a contribution takes its replies and its votes with it")
    void removalCascades() throws Exception {
        String slug = society(12);
        User author = user("9864000021", "Nikita Pandit");
        User other = user("9864000022", "Amol Chitale");
        String id = tip(author, slug, "The clubhouse needs booking a day ahead.");

        mvc.perform(post("/societies/" + slug + "/contributions/" + id + "/replies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(other))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"Good to know.\"}"))
                .andExpect(status().isCreated());
        mvc.perform(put("/societies/" + slug + "/contributions/" + id + "/helpful")
                        .header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(status().isOk());

        mvc.perform(delete("/societies/" + slug + "/contributions/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isNoContent());

        // The cascade lives in the database, so the delete has to reach it before we can look.
        em.flush();

        assertThat(jdbc.queryForObject(
                "select count(*) from society_contribution_replies where contribution_id = ?::uuid",
                Integer.class, id)).isZero();
        assertThat(jdbc.queryForObject(
                "select count(*) from society_contribution_helpful where contribution_id = ?::uuid",
                Integer.class, id)).isZero();
    }

    @Test
    @DisplayName("a contribution cannot be reached through another society's URL")
    void scopedToItsSociety() throws Exception {
        String here = society(13);
        String elsewhere = society(14);
        User u = user("9864000023", "Varun Limaye");
        String id = tip(u, here, "Gate 2 is closed at night.");

        mvc.perform(delete("/societies/" + elsewhere + "/contributions/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound());
        mvc.perform(put("/societies/" + elsewhere + "/contributions/" + id + "/helpful")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound());
    }
}
