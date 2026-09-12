package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * D240 slice 2 — the society hub's two community surfaces.
 *
 * <p>Both of these used to live in {@code localStorage}. A committee that posted "water off Tuesday
 * 6–10am" published it to itself and nobody else; every answer a resident wrote to a prospective
 * buyer's question was stored in the resident's own browser and read by no one. The hub rendered
 * convincingly throughout, which is exactly why it survived this long.
 *
 * <p>What is asserted here is what the browser-local version could not be:
 *
 * <ol>
 *   <li><strong>A question is readable by everyone, including a reader with no account.</strong>
 *       The person with the most to ask about a building has not moved into it, so questions are
 *       deliberately not resident-gated — and the reads are public so the page works before signup.</li>
 *   <li><strong>The resident badge is a fact about today.</strong> It is recomputed on every read,
 *       so a rejected resident's old answers stop claiming the badge. A stored copy would go on
 *       asserting it forever.</li>
 *   <li><strong>The noticeboard is gated and the Q&A is not.</strong> A notice asserts something
 *       about the building; a stranger is not in a position to assert it.</li>
 *   <li><strong>Events sort by when they happen, notices by when they were written.</strong> One
 *       ordering for both buries next week's AGM under a notice about the lift.</li>
 *   <li><strong>An event without a date is refused</strong> — it would sort into the calendar and
 *       render an empty date — and a notice <em>with</em> one has it dropped rather than refused.</li>
 *   <li><strong>Only the author, the committee or staff can take something down</strong>, and
 *       {@code canRemove} tells each viewer which of those they are.</li>
 * </ol>
 */
@DisplayName("Societies — questions and the noticeboard")
class SocietyCommunityTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * Mobile block 98630000xx — used by no other test class.
     *
     * <p>Nothing here provisions an account through a {@code REQUIRES_NEW} path, so the class-level
     * rollback takes these rows back out and no {@code @AfterAll} is needed.
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
     * A seeded society by position, not by name — see the sibling class for why.
     *
     * <p>{@code source <> 'community'} keeps the position stable against every mint the suite
     * performs; see {@code SocietyContributionTest#society} for what an unfiltered offset costs.
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

    /** Make {@code u} a verified resident of {@code slug}, the long way round through the API. */
    private void makeResident(User u, String slug, String flat, String reviewerAuth)
            throws Exception {
        String id = idOf(mvc.perform(post("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flat\":\"" + flat + "\",\"relation\":\"owner\"}"))
                .andExpect(status().isOk()));
        mvc.perform(patch("/societies/" + slug + "/residents/" + id)
                        .header(HttpHeaders.AUTHORIZATION, reviewerAuth)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"verified\"}"))
                .andExpect(status().isOk());
    }

    private ResultActions ask(User u, String slug, String body) throws Exception {
        return mvc.perform(post("/societies/" + slug + "/questions")
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"" + body + "\"}"));
    }

    private ResultActions postItem(String auth, String slug, String json) throws Exception {
        return mvc.perform(post("/societies/" + slug + "/board")
                .header(HttpHeaders.AUTHORIZATION, auth)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    /* ------------------------------------------------------------------ Q&A */

    @Test
    @DisplayName("anyone signed in can ask, and a reader with no account can read")
    void askAndReadPublicly() throws Exception {
        String slug = society(0);
        User asker = user("9863000001", "Prospective Buyer");

        ask(asker, slug, "Is the water supply metered?")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorName").value("Prospective Buyer"))
                // The asker lives nowhere near this building. That is the point: gating questions
                // on residency would leave the hub answering only what its residents already know.
                .andExpect(jsonPath("$.authorIsResident").value(false))
                .andExpect(jsonPath("$.answers").isArray())
                .andExpect(jsonPath("$.societySlug").value(slug));

        // No Authorization header at all — the read a visitor gets before they have signed up.
        mvc.perform(get("/societies/" + slug + "/questions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].body").value("Is the water supply metered?"))
                .andExpect(jsonPath("$.content[0].authorName").value("Prospective Buyer"));
    }

    @Test
    @DisplayName("a question with an empty body is refused rather than posted blank")
    void blankQuestionRejected() throws Exception {
        String slug = society(1);
        User asker = user("9863000002", "Blank Asker");

        ask(asker, slug, "   ").andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("an answer carries the resident badge and a stranger's does not")
    void answerBadging() throws Exception {
        String slug = society(2);
        String ops = staff("9863000003");
        User resident = user("9863000004", "Verified Neighbour");
        User stranger = user("9863000005", "Passer By");

        makeResident(resident, slug, "301", ops);

        String questionId = idOf(ask(stranger, slug, "How is the parking?")
                .andExpect(status().isCreated()));

        mvc.perform(post("/societies/" + slug + "/questions/" + questionId + "/answers")
                        .header(HttpHeaders.AUTHORIZATION, bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"One covered slot per flat.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorIsResident").value(true))
                .andExpect(jsonPath("$.questionId").value(questionId));

        mvc.perform(post("/societies/" + slug + "/questions/" + questionId + "/answers")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"I heard it is tight.\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorIsResident").value(false));

        mvc.perform(get("/societies/" + slug + "/questions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].answers.length()").value(2))
                // Answers read oldest-first: a thread is a conversation, and reading a reply
                // before the thing it replies to is unintelligible.
                .andExpect(jsonPath("$.content[0].answers[0].authorName").value("Verified Neighbour"));
    }

    @Test
    @DisplayName("rejecting a resident retracts the badge from everything they already wrote")
    void badgeIsRecomputedNotStored() throws Exception {
        String slug = society(3);
        String ops = staff("9863000006");
        User resident = user("9863000007", "Departing Resident");

        makeResident(resident, slug, "402", ops);
        ask(resident, slug, "When is the AGM?").andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorIsResident").value(true));

        // The committee later finds they never lived here. The old post must stop claiming it.
        String residentRowId = jdbc.queryForObject(
                "select r.id::text from society_residents r join societies s on s.id = r.society_id"
                        + " where s.slug = ? and r.user_id = ?",
                String.class, slug, resident.getId());
        mvc.perform(patch("/societies/" + slug + "/residents/" + residentRowId)
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/questions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].authorIsResident").value(false));
    }

    @Test
    @DisplayName("an answer cannot be posted to another society's question through this society's URL")
    void answerIsScopedToItsSociety() throws Exception {
        String here = society(4);
        String elsewhere = society(5);
        User asker = user("9863000008", "Cross Poster");

        String questionId = idOf(ask(asker, elsewhere, "Anything to know?")
                .andExpect(status().isCreated()));

        mvc.perform(post("/societies/" + here + "/questions/" + questionId + "/answers")
                        .header(HttpHeaders.AUTHORIZATION, bearer(asker))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"Lots.\"}"))
                .andExpect(status().isNotFound());
    }

    /* ---------------------------------------------------------------- board */

    @Test
    @DisplayName("a stranger cannot post a notice, a verified resident can")
    void boardIsResidentGated() throws Exception {
        String slug = society(6);
        String ops = staff("9863000009");
        User stranger = user("9863000010", "Not From Here");
        User resident = user("9863000011", "Actual Resident");

        postItem(bearer(stranger), slug,
                "{\"kind\":\"notice\",\"title\":\"Cheap painting service\"}")
                .andExpect(status().isForbidden());

        makeResident(resident, slug, "101", ops);

        postItem(bearer(resident), slug,
                "{\"kind\":\"notice\",\"title\":\"Lift servicing on Friday\",\"body\":\"9am to 1pm\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorIsResident").value(true))
                .andExpect(jsonPath("$.canRemove").value(true))
                // A notice never carries a date, even if the caller sends one.
                .andExpect(jsonPath("$.eventDate").doesNotExist());
    }

    @Test
    @DisplayName("an event needs a date; a notice that sends one has it dropped")
    void eventDateRules() throws Exception {
        String slug = society(7);
        String ops = staff("9863000012");

        postItem(ops, slug, "{\"kind\":\"event\",\"title\":\"AGM\"}")
                .andExpect(status().isBadRequest());

        postItem(ops, slug,
                "{\"kind\":\"event\",\"title\":\"AGM\",\"eventDate\":\"2027-03-14\",\"eventTime\":\"18:30\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.eventDate").value("2027-03-14"));

        // A dated notice would sort into the calendar and claim to be something that happens.
        postItem(ops, slug,
                "{\"kind\":\"notice\",\"title\":\"New gate code\",\"eventDate\":\"2027-03-14\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.eventDate").doesNotExist());

        postItem(ops, slug, "{\"kind\":\"gossip\",\"title\":\"Anything\"}")
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("upcoming events sort ahead of notices, however recently the notice was written")
    void boardOrdering() throws Exception {
        String slug = society(8);
        String ops = staff("9863000013");

        postItem(ops, slug, "{\"kind\":\"event\",\"title\":\"Later AGM\",\"eventDate\":\"2027-06-01\"}")
                .andExpect(status().isCreated());
        postItem(ops, slug, "{\"kind\":\"event\",\"title\":\"Sooner tanker\",\"eventDate\":\"2027-04-02\"}")
                .andExpect(status().isCreated());
        // Written last, so a naive newest-first board would put it on top and bury both events.
        postItem(ops, slug, "{\"kind\":\"notice\",\"title\":\"Lift is noisy\"}")
                .andExpect(status().isCreated());

        mvc.perform(get("/societies/" + slug + "/board"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].title").value("Sooner tanker"))
                .andExpect(jsonPath("$.content[1].title").value("Later AGM"))
                .andExpect(jsonPath("$.content[2].title").value("Lift is noisy"));

        mvc.perform(get("/societies/" + slug + "/board").param("kind", "notice"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Lift is noisy"));

        mvc.perform(get("/societies/" + slug + "/board").param("kind", "rumour"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("the board reads without a token, and tells an anonymous reader it cannot delete")
    void boardReadsPublicly() throws Exception {
        String slug = society(9);
        String ops = staff("9863000014");

        postItem(ops, slug, "{\"kind\":\"notice\",\"title\":\"Water tank cleaning\"}")
                .andExpect(status().isCreated());

        mvc.perform(get("/societies/" + slug + "/board"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].title").value("Water tank cleaning"))
                // An anonymous reader is offered no delete control — the alternative is a button
                // that 403s, which reads as a broken page rather than a rule.
                .andExpect(jsonPath("$.content[0].canRemove").value(false));
    }

    @Test
    @DisplayName("a neighbour cannot delete someone else's notice, but the committee can")
    void removalRules() throws Exception {
        String slug = society(10);
        String ops = staff("9863000015");
        User author = user("9863000016", "Board Author");
        User neighbour = user("9863000017", "Nosy Neighbour");
        User committee = user("9863000018", "Hon Secretary");

        makeResident(author, slug, "501", ops);
        makeResident(neighbour, slug, "502", ops);

        String claimId = idOf(mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(committee))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Hon Secretary\",\"role\":\"Secretary\"}"))
                .andExpect(status().isOk()));
        mvc.perform(patch("/admin/society-claims/" + claimId)
                        .header(HttpHeaders.AUTHORIZATION, ops)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());

        String itemId = idOf(postItem(bearer(author), slug,
                "{\"kind\":\"notice\",\"title\":\"Society picnic\"}")
                .andExpect(status().isCreated()));

        // The neighbour is a verified resident here — residency buys posting, not moderation.
        mvc.perform(get("/societies/" + slug + "/board")
                        .header(HttpHeaders.AUTHORIZATION, bearer(neighbour)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].canRemove").value(false));

        mvc.perform(delete("/societies/" + slug + "/board/" + itemId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(neighbour)))
                .andExpect(status().isForbidden());

        mvc.perform(get("/societies/" + slug + "/board")
                        .header(HttpHeaders.AUTHORIZATION, bearer(committee)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].canRemove").value(true));

        mvc.perform(delete("/societies/" + slug + "/board/" + itemId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(committee)))
                .andExpect(status().isNoContent());

        mvc.perform(get("/societies/" + slug + "/board"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @DisplayName("the author can take their own notice down")
    void authorCanSelfRemove() throws Exception {
        String slug = society(11);
        String ops = staff("9863000019");
        User author = user("9863000020", "Self Remover");

        makeResident(author, slug, "601", ops);
        String itemId = idOf(postItem(bearer(author), slug,
                "{\"kind\":\"notice\",\"title\":\"Posted by mistake\"}")
                .andExpect(status().isCreated()));

        mvc.perform(delete("/societies/" + slug + "/board/" + itemId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("an unknown society is a 404 on every one of these routes")
    void unknownSociety() throws Exception {
        User anyone = user("9863000021", "Lost");

        mvc.perform(get("/societies/no-such-society-anywhere/questions"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/societies/no-such-society-anywhere/board"))
                .andExpect(status().isNotFound());
        ask(anyone, "no-such-society-anywhere", "Hello?").andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("writing needs a token even though reading does not")
    void writesRequireAuth() throws Exception {
        String slug = society(12);

        mvc.perform(post("/societies/" + slug + "/questions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"Anonymous question\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/societies/" + slug + "/board")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"notice\",\"title\":\"Anonymous notice\"}"))
                .andExpect(status().isUnauthorized());
    }
}
