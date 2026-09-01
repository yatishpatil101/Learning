package com.punenest.api.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.Roles;
import com.punenest.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * D240 slice 6 — reporting society-hub content, and the report actually landing.
 *
 * <p>The society hub offers a "Report" control on every recommendation, reply, question, answer and
 * noticeboard item. Pressing it wrote a row to {@code pnSocietyReports} in the reporting member's
 * own browser, and the ops queue that was meant to read those reports read the <em>moderator's</em>
 * browser. So the queue was permanently empty by construction: a recommendation naming a real
 * tradesman with his real mobile number could be reported by fifty neighbours and no moderator
 * would ever see one of them, because each of the fifty complaints was sitting in a different
 * phone.
 *
 * <p>The platform-wide {@code reports} table has worked properly since V18. It simply did not admit
 * that society content existed — {@code reports_target_type_check} allowed {@code property},
 * {@code user}, {@code review} and {@code post}, so a society report had nowhere to go even if the
 * client had tried to send one.
 *
 * <p>What is asserted here is the whole round trip, because either half alone is worse than
 * useless:
 *
 * <ol>
 *   <li><strong>A neighbour can file</strong>, against any of the five kinds, using a vocabulary
 *       that includes the complaint this surface actually attracts — {@code personal}, somebody's
 *       contact details published by a third party.</li>
 *   <li><strong>A moderator can remove</strong>, and the content leaves every public read.</li>
 *   <li><strong>Removal is a stamp, not a delete.</strong> The complaint was about the contents, so
 *       destroying them destroys the appeal and the repeat-offender check in the same statement.</li>
 *   <li><strong>The second moderator to reach the same target does not overwrite the first.</strong>
 *       Two neighbours reporting one post is the ordinary case; the record of who removed it is the
 *       only thing that answers an appeal.</li>
 *   <li><strong>An enforcement that cannot be carried out fails the whole triage.</strong> Closing
 *       a complaint with the moderator believing something was done is the defect this replaces.</li>
 * </ol>
 */
@DisplayName("Reports — society hub content")
class SocietyContentReportTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * Audit writes run {@code REQUIRES_NEW} and commit past this class's rollback, so every actor
     * created here has its rows removed by hand. Without this the class is order-dependent against
     * anything that counts {@code audit_log}.
     */
    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    /** Mobile block 98670000xx — used by no other test class. */
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

    /**
     * A seeded society by position, not by name — seed display names are not unique.
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

    /* ------------------------------------------------------------- fixtures, one per kind */

    private String contribution(User author, String slug) throws Exception {
        return idOf(mvc.perform(post("/societies/" + slug + "/contributions")
                .header(HttpHeaders.AUTHORIZATION, bearer(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"pick\",\"referralName\":\"Vishal the electrician\","
                        + "\"referralContact\":\"9822001122\",\"body\":\"Call him any time.\"}"))
                .andExpect(status().isCreated()));
    }

    private String reply(User author, String slug, String contributionId) throws Exception {
        return idOf(mvc.perform(
                post("/societies/" + slug + "/contributions/" + contributionId + "/replies")
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"He is also my brother-in-law, ring 9822001122.\"}"))
                .andExpect(status().isCreated()));
    }

    private String question(User author, String slug) throws Exception {
        return idOf(mvc.perform(post("/societies/" + slug + "/questions")
                .header(HttpHeaders.AUTHORIZATION, bearer(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Is the water supply metered here?\"}"))
                .andExpect(status().isCreated()));
    }

    private String answer(User author, String slug, String questionId) throws Exception {
        return idOf(mvc.perform(post("/societies/" + slug + "/questions/" + questionId + "/answers")
                .header(HttpHeaders.AUTHORIZATION, bearer(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"body\":\"Yes, and the secretary is a crook.\"}"))
                .andExpect(status().isCreated()));
    }

    /**
     * Posted by staff, because the board is the one society surface with a gate on the way in —
     * only a verified resident, the committee or staff may post a notice. What is under test here
     * is the way <em>out</em>, so the fixture takes the shortest legal route in.
     */
    private String boardItem(User author, String slug) throws Exception {
        return idOf(mvc.perform(post("/societies/" + slug + "/board")
                .header(HttpHeaders.AUTHORIZATION, bearer(author))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"notice\",\"title\":\"Lift repair\","
                        + "\"body\":\"Complain to 9822001122 about the lift.\"}"))
                .andExpect(status().isCreated()));
    }

    /* ------------------------------------------------------------- filing */

    private ResultActions file(User reporter, String targetType, String targetId, String reason)
            throws Exception {
        return mvc.perform(post("/reports")
                .header(HttpHeaders.AUTHORIZATION, bearer(reporter))
                .contentType(MediaType.APPLICATION_JSON)
                .content(("{\"targetType\":\"%s\",\"targetId\":\"%s\",\"reason\":\"%s\","
                        + "\"details\":\"This is his number and he never agreed to it.\"}")
                        .formatted(targetType, targetId, reason)));
    }

    @Test
    @DisplayName("all five society kinds are reportable — the queue used to refuse every one of them")
    void everySocietyKindIsAcceptedByTheQueue() throws Exception {
        String slug = society(2);
        User author = user("9867000001", "Ishita Rane");
        User reporter = user("9867000002", "Neighbour");
        User poster = user("9867000046", "Ops poster", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String replyId = reply(author, slug, contributionId);
        String questionId = question(author, slug);
        String answerId = answer(author, slug, questionId);
        String boardId = boardItem(poster, slug);

        // Five separate vocabulary words, not one 'society_content': targetId means nothing
        // without knowing which table it indexes, and a moderator has to remove *that* row.
        file(reporter, "society_contribution", contributionId, "personal")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.targetType").value("society_contribution"))
                .andExpect(jsonPath("$.status").value("open"));
        file(reporter, "society_reply", replyId, "personal").andExpect(status().isCreated());
        file(reporter, "society_question", questionId, "spam").andExpect(status().isCreated());
        file(reporter, "society_answer", answerId, "abuse").andExpect(status().isCreated());
        file(reporter, "society_board", boardId, "fake").andExpect(status().isCreated());
    }

    /**
     * The reason vocabulary is a function of what was reported, and society content gets its own —
     * {@code pricing} is a real complaint about a listing and a meaningless one about a neighbour's
     * question.
     */
    @Test
    @DisplayName("a listing's reason is not a complaint you can make about a society post")
    void reasonIsValidatedAgainstTheSocietyVocabulary() throws Exception {
        String slug = society(3);
        User author = user("9867000003", "Author");
        User reporter = user("9867000004", "Neighbour");
        String questionId = question(author, slug);

        file(reporter, "society_question", questionId, "pricing")
                .andExpect(status().isBadRequest());
    }

    /**
     * {@code personal} exists nowhere else, and it is the reason the society set is not the review
     * set: the most damaging thing on a hub is a third party's contact details, published by
     * somebody who is not that person and has no standing to publish them.
     */
    @Test
    @DisplayName("'personal' is a complaint only society content can attract")
    void personalIsSocietyOnly() throws Exception {
        String slug = society(4);
        User author = user("9867000005", "Author");
        User reporter = user("9867000006", "Neighbour");
        String contributionId = contribution(author, slug);

        file(reporter, "society_contribution", contributionId, "personal")
                .andExpect(status().isCreated());

        // Not a thing you can say about a listing.
        file(reporter, "property", UUID.randomUUID().toString(), "personal")
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("one neighbour cannot file the same complaint twice, but two neighbours can")
    void duplicateGuardIsPerReporter() throws Exception {
        String slug = society(5);
        User author = user("9867000007", "Author");
        User first = user("9867000008", "First");
        User second = user("9867000009", "Second");
        String contributionId = contribution(author, slug);

        file(first, "society_contribution", contributionId, "personal")
                .andExpect(status().isCreated());
        file(first, "society_contribution", contributionId, "abuse")
                .andExpect(status().isConflict());

        // Fifty neighbours complaining about one post is the signal, not the noise.
        file(second, "society_contribution", contributionId, "personal")
                .andExpect(status().isCreated());
    }

    /* ------------------------------------------------------------- the decision lands */

    private ResultActions triage(User staff, String reportId, String status, String enforcement)
            throws Exception {
        return mvc.perform(patch("/reports/{id}", reportId)
                .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"%s\",\"note\":\"upheld\",\"enforcement\":\"%s\"}"
                        .formatted(status, enforcement)));
    }

    private String fileAndId(User reporter, String targetType, String targetId, String reason)
            throws Exception {
        return idOf(file(reporter, targetType, targetId, reason).andExpect(status().isCreated()));
    }

    @Test
    @DisplayName("upholding a complaint takes the recommendation off the public tab")
    void hideContentRemovesAContribution() throws Exception {
        String slug = society(6);
        User author = user("9867000010", "Author");
        User reporter = user("9867000011", "Neighbour");
        User staff = user("9867000012", "Ops", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String reportId = fileAndId(reporter, "society_contribution", contributionId, "personal");

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

        triage(staff, reportId, "actioned", "hide_content")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("actioned"));

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    /**
     * The row survives. That is the whole difference between this and the author's own DELETE: the
     * complaint was about the contents, so a hard delete would destroy the appeal, the
     * repeat-offender check and any lawful request in the same statement.
     */
    @Test
    @DisplayName("removal is a stamp, not a delete — the evidence survives, attributed to the moderator")
    void removalKeepsTheRowAndNamesTheModerator() throws Exception {
        String slug = society(7);
        User author = user("9867000013", "Author");
        User reporter = user("9867000014", "Neighbour");
        User staff = user("9867000015", "Ops", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String reportId = fileAndId(reporter, "society_contribution", contributionId, "personal");
        triage(staff, reportId, "actioned", "hide_content").andExpect(status().isOk());

        assertThat(jdbc.queryForObject(
                "select count(*) from society_contributions where id = ?::uuid",
                Integer.class, contributionId))
                .as("the reported row is kept, not deleted")
                .isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "select removed_by from society_contributions where id = ?::uuid",
                UUID.class, contributionId))
                .isEqualTo(staff.getId());
        assertThat(jdbc.queryForObject(
                "select removed_at is not null from society_contributions where id = ?::uuid",
                Boolean.class, contributionId))
                .isTrue();
        // The referral contact is still on the row — the person it names may want it produced.
        assertThat(jdbc.queryForObject(
                "select referral_contact from society_contributions where id = ?::uuid",
                String.class, contributionId))
                .isEqualTo("9822001122");
    }

    @Test
    @DisplayName("removing a reply leaves the recommendation it hangs on alone")
    void hideContentRemovesAReplyOnly() throws Exception {
        String slug = society(8);
        User author = user("9867000016", "Author");
        User reporter = user("9867000017", "Neighbour");
        User staff = user("9867000018", "Ops", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String replyId = reply(author, slug, contributionId);
        String reportId = fileAndId(reporter, "society_reply", replyId, "personal");

        triage(staff, reportId, "actioned", "hide_content").andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].replies").isEmpty());
    }

    /**
     * A thread whose question has gone is a page of replies to nothing, so the answers go with it —
     * which is what removing the question already means, since answers are only readable through it.
     */
    @Test
    @DisplayName("removing a question takes its answers off the page with it")
    void hideContentRemovesAQuestionAndItsThread() throws Exception {
        String slug = society(9);
        User author = user("9867000019", "Author");
        User reporter = user("9867000020", "Neighbour");
        User staff = user("9867000021", "Ops", Roles.Wire.STAFF);

        String questionId = question(author, slug);
        answer(author, slug, questionId);
        String reportId = fileAndId(reporter, "society_question", questionId, "abuse");

        triage(staff, reportId, "actioned", "hide_content").andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/questions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @DisplayName("removing an answer leaves the question standing")
    void hideContentRemovesAnAnswerOnly() throws Exception {
        String slug = society(10);
        User author = user("9867000022", "Author");
        User reporter = user("9867000023", "Neighbour");
        User staff = user("9867000024", "Ops", Roles.Wire.STAFF);

        String questionId = question(author, slug);
        String answerId = answer(author, slug, questionId);
        String reportId = fileAndId(reporter, "society_answer", answerId, "abuse");

        triage(staff, reportId, "actioned", "hide_content").andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/questions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].answers").isEmpty());
    }

    @Test
    @DisplayName("removing a noticeboard item takes it off the board")
    void hideContentRemovesABoardItem() throws Exception {
        String slug = society(11);
        User author = user("9867000025", "Author");
        User reporter = user("9867000026", "Neighbour");
        User staff = user("9867000027", "Ops", Roles.Wire.STAFF);

        String boardId = boardItem(staff, slug);
        String reportId = fileAndId(reporter, "society_board", boardId, "personal");

        triage(staff, reportId, "actioned", "hide_content").andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/board"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    /* ------------------------------------------------------------- the guards */

    /**
     * Two neighbours reporting one post is the ordinary case. The second moderator to clear it has
     * done nothing wrong, so the call succeeds — but it must not restamp {@code removed_by}, which
     * is the only field that answers "who took this down, and when".
     */
    @Test
    @DisplayName("a second moderator clearing the same target does not overwrite who removed it first")
    void removalIsIdempotentAndDoesNotRestamp() throws Exception {
        String slug = society(12);
        User author = user("9867000028", "Author");
        User first = user("9867000029", "First");
        User second = user("9867000030", "Second");
        User staffA = user("9867000031", "Ops A", Roles.Wire.STAFF);
        User staffB = user("9867000032", "Ops B", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String reportA = fileAndId(first, "society_contribution", contributionId, "personal");
        String reportB = fileAndId(second, "society_contribution", contributionId, "abuse");

        triage(staffA, reportA, "actioned", "hide_content").andExpect(status().isOk());
        triage(staffB, reportB, "actioned", "hide_content").andExpect(status().isOk());

        assertThat(jdbc.queryForObject(
                "select removed_by from society_contributions where id = ?::uuid",
                UUID.class, contributionId))
                .as("the first moderator's name survives the second decision")
                .isEqualTo(staffA.getId());
    }

    /**
     * Deciding the report anyway and recording that the enforcement "did not apply" closes a
     * complaint with the moderator believing something was done. Nothing commits, so the moderator
     * sees the failure and can dismiss instead.
     *
     * <p>Nothing is read back afterwards on purpose: the service's rollback marks this test's own
     * transaction rollback-only, so a follow-up query here would fail for a reason that has nothing
     * to do with the behaviour. The status code <em>is</em> the assertion — a 404 out of a
     * {@code @Transactional} method is what guarantees the report did not move.
     */
    @Test
    @DisplayName("upholding a complaint about content that has since gone fails the whole triage")
    void missingTargetFailsTheDecision() throws Exception {
        User reporter = user("9867000033", "Neighbour");
        User staff = user("9867000034", "Ops", Roles.Wire.STAFF);

        String reportId = fileAndId(reporter, "society_contribution",
                UUID.randomUUID().toString(), "personal");

        triage(staff, reportId, "actioned", "hide_content")
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("'dismissed, and also taken down' is not a decision anybody means")
    void dismissalCannotEnforce() throws Exception {
        String slug = society(13);
        User author = user("9867000035", "Author");
        User reporter = user("9867000036", "Neighbour");
        User staff = user("9867000037", "Ops", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String reportId = fileAndId(reporter, "society_contribution", contributionId, "personal");

        triage(staff, reportId, "dismissed", "hide_content")
                .andExpect(status().isBadRequest());

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    /**
     * The abuse queue takes content down; it does not suspend accounts on the strength of one post.
     * The refusal names what can be done instead rather than saying only "not allowed".
     */
    @Test
    @DisplayName("a society post cannot be used to suspend its author from the report queue")
    void suspendAccountIsRefusedForSocietyContent() throws Exception {
        String slug = society(14);
        User author = user("9867000038", "Author");
        User reporter = user("9867000039", "Neighbour");
        User staff = user("9867000040", "Ops", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String reportId = fileAndId(reporter, "society_contribution", contributionId, "personal");

        triage(staff, reportId, "actioned", "suspend_account")
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a neighbour cannot moderate — filing is open, deciding is not")
    void residencyDoesNotBuyModeration() throws Exception {
        String slug = society(15);
        User author = user("9867000041", "Author");
        User reporter = user("9867000042", "Neighbour");

        String contributionId = contribution(author, slug);
        String reportId = fileAndId(reporter, "society_contribution", contributionId, "personal");

        triage(reporter, reportId, "actioned", "hide_content")
                .andExpect(status().isForbidden());

        mvc.perform(get("/societies/" + slug + "/contributions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    /** The queue's filter is validated against the vocabulary, or a typo reads as "queue clear". */
    @Test
    @DisplayName("the queue can be filtered down to one society kind")
    void queueFiltersBySocietyKind() throws Exception {
        String slug = society(16);
        User author = user("9867000043", "Author");
        User reporter = user("9867000044", "Neighbour");
        User staff = user("9867000045", "Ops", Roles.Wire.STAFF);

        String contributionId = contribution(author, slug);
        String boardId = boardItem(staff, slug);
        fileAndId(reporter, "society_contribution", contributionId, "personal");
        fileAndId(reporter, "society_board", boardId, "personal");

        mvc.perform(get("/reports").param("targetType", "society_board")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].targetType").value("society_board"));

        mvc.perform(get("/reports").param("targetType", "society_notaThing")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isBadRequest());
    }
}
