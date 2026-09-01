package com.punenest.api.engagement;

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
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * D240 — who lives in a society, and who runs its page.
 *
 * <p>Until this slice the answer to both lived in {@code localStorage}, owned by the person being
 * asked about. A resident who verified their flat on a laptop was a stranger on their phone; a
 * committee approving a neighbour approved them only in its own browser; and "one verified resident
 * per flat" was a rule enforced against a single device's memory of itself.
 *
 * <p>What is asserted here is the part that could not previously be true at all:
 *
 * <ol>
 *   <li><strong>A flat has one verified resident.</strong> Enforced by a partial unique index, so
 *       the second verification is refused rather than overwriting the first — and rejecting the
 *       outgoing resident frees the flat, because a handover must not need a DBA.</li>
 *   <li><strong>The reviewer is decided by the claim, not by a role.</strong> An unclaimed society
 *       is reviewed by ops; a claimed one reviews itself. Neither a resident nor a stranger may
 *       read the queue, because the queue publishes names and mobiles.</li>
 *   <li><strong>Approving a claim moves the society and the queue with it.</strong> A claim that
 *       says approved while the society still says unclaimed is a committee holding a permission
 *       the hub renders no control for.</li>
 *   <li><strong>The public membership read withholds the claimant's contact details.</strong> Who
 *       claimed a society must not be a way to lift a committee member's number off a page anybody
 *       can load.</li>
 * </ol>
 */
@DisplayName("Societies — residents, claims and who reviews them")
class SocietyMembershipTest extends AbstractApiTest {

    @Autowired UserRepository users;

    /**
     * Mobile block 98620000xx, used by no other test class.
     *
     * <p>No {@code @AfterAll} cleanup: nothing here provisions an account through a
     * {@code REQUIRES_NEW} path, so the class-level rollback takes these back out again.
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
     * A seeded society, taken by position rather than by name.
     *
     * <p>Naming a slug would tie this file to the demo seed, and the seed is data: a curation pass
     * that renames a building should not turn a rule about flats red.
     */
    private String society(int offset) {
        List<String> slugs = jdbc.queryForList(
                "select slug from societies order by slug offset ? limit 1", String.class, offset);
        assertThat(slugs).as("a seeded society at offset " + offset).hasSize(1);
        return slugs.get(0);
    }

    private ResultActions apply(User u, String slug, String wing, String flat) throws Exception {
        return mvc.perform(post("/societies/" + slug + "/residents")
                .header(HttpHeaders.AUTHORIZATION, bearer(u))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"wing\":\"" + wing + "\",\"flat\":\"" + flat
                        + "\",\"relation\":\"owner\"}"));
    }

    private String idOf(ResultActions r) throws Exception {
        String json = r.andReturn().getResponse().getContentAsString();
        int at = json.indexOf("\"id\":\"") + 6;
        return json.substring(at, json.indexOf('"', at));
    }

    private ResultActions decide(String auth, String slug, String id, String status)
            throws Exception {
        return mvc.perform(patch("/societies/" + slug + "/residents/" + id)
                .header(HttpHeaders.AUTHORIZATION, auth)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"" + status + "\"}"));
    }

    private String claim(User u, String slug) throws Exception {
        return idOf(mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Committee Member\",\"role\":\"Hon. Secretary\","
                                + "\"email\":\"sec@example.com\"}"))
                .andExpect(status().isOk()));
    }

    private void approveClaim(String claimId) throws Exception {
        mvc.perform(patch("/admin/society-claims/" + claimId)
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000090"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"approved\"}"))
                .andExpect(status().isOk());
    }

    /* --------------------------------------------------------------- the flat */

    @Test
    @DisplayName("wing and flat normalise to one unit key — B-704 and b 704 are the same flat")
    void unitKeyIsNormalised() throws Exception {
        String slug = society(0);
        apply(user("9862000001", "Asha"), slug, "B", "704")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unitKey").value("B704"));
        apply(user("9862000002", "Bharat"), slug, "b-", " 704 ")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unitKey").value("B704"));
    }

    @Test
    @DisplayName("a flat somebody else already holds flags the request but does not refuse it")
    void conflictIsAdvisoryAtRequestTime() throws Exception {
        String slug = society(1);
        User first = user("9862000003", "Chetan");
        String id = idOf(apply(first, slug, "A", "101").andExpect(status().isOk()));
        decide(staff("9862000091"), slug, id, "verified").andExpect(status().isOk());

        // The server cannot tell a handover from an impostor. The committee can, so the request is
        // recorded and marked rather than rejected at the door.
        apply(user("9862000004", "Deepa"), slug, "A", "101")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.flagged").value("conflict"));
    }

    @Test
    @DisplayName("two people cannot both be verified in one flat")
    void oneVerifiedResidentPerFlat() throws Exception {
        String slug = society(2);
        String ops = staff("9862000092");
        String firstId = idOf(apply(user("9862000005", "Esha"), slug, "C", "12")
                .andExpect(status().isOk()));
        decide(ops, slug, firstId, "verified").andExpect(status().isOk());

        String secondId = idOf(apply(user("9862000006", "Farhan"), slug, "C", "12")
                .andExpect(status().isOk()));
        decide(ops, slug, secondId, "verified").andExpect(status().isConflict());
    }

    @Test
    @DisplayName("rejecting the outgoing resident frees the flat for the new one")
    void rejectingReleasesTheUnit() throws Exception {
        String slug = society(3);
        String ops = staff("9862000093");
        String outgoing = idOf(apply(user("9862000007", "Girish"), slug, "D", "5")
                .andExpect(status().isOk()));
        decide(ops, slug, outgoing, "verified").andExpect(status().isOk());

        String incoming = idOf(apply(user("9862000008", "Heena"), slug, "D", "5")
                .andExpect(status().isOk()));
        decide(ops, slug, incoming, "verified").andExpect(status().isConflict());

        decide(ops, slug, outgoing, "rejected").andExpect(status().isOk());
        decide(ops, slug, incoming, "verified")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("verified"))
                // The advisory flag is cleared on verification: it described a state that no longer
                // holds, and leaving it would tell the hub this resident is disputed forever.
                .andExpect(jsonPath("$.flagged").doesNotExist());
    }

    @Test
    @DisplayName("re-applying amends the standing request instead of queueing a second")
    void reapplyingAmends() throws Exception {
        String slug = society(4);
        User u = user("9862000009", "Ishaan");
        String first = idOf(apply(u, slug, "E", "1").andExpect(status().isOk()));
        String second = idOf(apply(u, slug, "E", "2").andExpect(status().isOk()));
        assertThat(second).isEqualTo(first);

        mvc.perform(get("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000094")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].unitKey").value("E2"));
    }

    @Test
    @DisplayName("a verified resident cannot quietly move themselves to a different flat")
    void verifiedResidentCannotSelfMove() throws Exception {
        String slug = society(5);
        User u = user("9862000010", "Jaya");
        String id = idOf(apply(u, slug, "F", "9").andExpect(status().isOk()));
        decide(staff("9862000095"), slug, id, "verified").andExpect(status().isOk());

        apply(u, slug, "F", "10").andExpect(status().isConflict());
    }

    @Test
    @DisplayName("relation is a closed set and defaults to resident")
    void relationVocabulary() throws Exception {
        String slug = society(6);
        mvc.perform(post("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000011", "Kabir")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flat\":\"3\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.relation").value("resident"));

        mvc.perform(post("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000012", "Latika")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flat\":\"4\",\"relation\":\"landlord\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("a flat of only punctuation is refused — it would normalise to nothing")
    void emptyUnitKeyIsRefused() throws Exception {
        mvc.perform(post("/societies/" + society(7) + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000013", "Manav")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"flat\":\"--\"}"))
                .andExpect(status().isBadRequest());
    }

    /* ------------------------------------------------------------ who reviews */

    @Test
    @DisplayName("an unclaimed society's requests go to ops; a claimed one's go to its committee")
    void queueFollowsTheClaim() throws Exception {
        String slug = society(8);
        apply(user("9862000014", "Nilesh"), slug, "G", "1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedTo").value("ops"));

        approveClaim(claim(user("9862000015", "Omkar"), slug));

        apply(user("9862000016", "Pallavi"), slug, "G", "2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedTo").value("committee"));
    }

    @Test
    @DisplayName("approving a claim re-homes the requests ops had not got to yet")
    void approvingReassignsPendingRequests() throws Exception {
        String slug = society(9);
        User waiting = user("9862000017", "Qadir");
        apply(waiting, slug, "H", "1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedTo").value("ops"));

        approveClaim(claim(user("9862000018", "Rhea"), slug));

        mvc.perform(get("/societies/" + slug + "/membership")
                        .header(HttpHeaders.AUTHORIZATION, bearer(waiting)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resident.assignedTo").value("committee"));
    }

    @Test
    @DisplayName("the approved claimant reviews their own society; a neighbour does not")
    void onlyTheCommitteeOrStaffMayReview() throws Exception {
        String slug = society(10);
        User committee = user("9862000019", "Sneha");
        approveClaim(claim(committee, slug));

        User applicant = user("9862000020", "Tarun");
        String id = idOf(apply(applicant, slug, "J", "1").andExpect(status().isOk()));

        // Living here is not a licence to read every neighbour's mobile.
        mvc.perform(get("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(applicant)))
                .andExpect(status().isForbidden());
        decide(bearer(applicant), slug, id, "verified").andExpect(status().isForbidden());

        decide(bearer(committee), slug, id, "verified").andExpect(status().isOk());
    }

    @Test
    @DisplayName("the review queue publishes the applicant's name and mobile")
    void theReviewerSeesWhoIsAsking() throws Exception {
        String slug = society(11);
        apply(user("9862000021", "Urmila"), slug, "K", "1").andExpect(status().isOk());

        // A deliberate exception to withholding identity: the question is "does this person live in
        // K/1", and it is answered against a members' register that has names in it.
        mvc.perform(get("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000096")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].name").value("Urmila"))
                .andExpect(jsonPath("$.content[0].mobile").value("9862000021"));
    }

    @Test
    @DisplayName("an unknown decision word is refused rather than written through")
    void decisionVocabulary() throws Exception {
        String slug = society(12);
        String id = idOf(apply(user("9862000022", "Vikas"), slug, "L", "1")
                .andExpect(status().isOk()));
        decide(staff("9862000097"), slug, id, "approved").andExpect(status().isBadRequest());
    }

    /* ---------------------------------------------------------------- claims */

    @Test
    @DisplayName("a second committee cannot claim a society that is already spoken for")
    void oneLiveClaimPerSociety() throws Exception {
        String slug = society(13);
        claim(user("9862000023", "Wasim"), slug);

        mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000024", "Xena")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Rival\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("the claimant may correct their own pending claim")
    void amendingYourOwnClaim() throws Exception {
        String slug = society(14);
        User u = user("9862000025", "Yash");
        String first = claim(u, slug);
        String again = idOf(mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Yash Kulkarni\",\"role\":\"Chairman\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claimantName").value("Yash Kulkarni")));
        assertThat(again).isEqualTo(first);
    }

    @Test
    @DisplayName("a rejected claim leaves the society open to the committee that really runs it")
    void rejectionReopensTheSociety() throws Exception {
        String slug = society(15);
        String impostor = claim(user("9862000026", "Zoya"), slug);
        mvc.perform(patch("/admin/society-claims/" + impostor)
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000098"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"rejected\",\"note\":\"Not on the committee\"}"))
                .andExpect(status().isOk());

        claim(user("9862000027", "Aarav"), slug);
        assertThat(jdbc.queryForObject("select claim_status from societies where slug = ?",
                String.class, slug)).isEqualTo("pending");
    }

    @Test
    @DisplayName("approving a claim moves the society's own claimStatus with it")
    void approvalMovesTheSociety() throws Exception {
        String slug = society(16);
        approveClaim(claim(user("9862000028", "Bhavna"), slug));
        assertThat(jdbc.queryForObject("select claim_status from societies where slug = ?",
                String.class, slug)).isEqualTo("claimed");
    }

    /* ------------------------------------------------------------ membership */

    @Test
    @DisplayName("a stranger gets the society's facts and none of their own")
    void membershipIsPublicAndCallerAware() throws Exception {
        String slug = society(17);
        mvc.perform(get("/societies/" + slug + "/membership"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.societySlug").value(slug))
                .andExpect(jsonPath("$.resident").doesNotExist())
                .andExpect(jsonPath("$.admin").value(false))
                .andExpect(jsonPath("$.verifiedResidents").value(0));
    }

    @Test
    @DisplayName("the public membership read never carries the claimant's mobile or email")
    void membershipWithholdsClaimantContact() throws Exception {
        String slug = society(18);
        claim(user("9862000029", "Chirag"), slug);

        mvc.perform(get("/societies/" + slug + "/membership"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claim.status").value("pending"))
                .andExpect(jsonPath("$.claim.claimantName").value("Committee Member"))
                .andExpect(jsonPath("$.claim.claimantMobile").doesNotExist())
                .andExpect(jsonPath("$.claim.email").doesNotExist());
    }

    @Test
    @DisplayName("the claimant is the society admin, and the verified count is the society's own")
    void membershipReportsAdminAndCount() throws Exception {
        String slug = society(19);
        User committee = user("9862000030", "Divya");
        approveClaim(claim(committee, slug));

        String id = idOf(apply(user("9862000031", "Eshan"), slug, "M", "1")
                .andExpect(status().isOk()));
        decide(bearer(committee), slug, id, "verified").andExpect(status().isOk());

        mvc.perform(get("/societies/" + slug + "/membership")
                        .header(HttpHeaders.AUTHORIZATION, bearer(committee)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.admin").value(true))
                .andExpect(jsonPath("$.verifiedResidents").value(1));

        mvc.perform(get("/societies/" + slug + "/membership")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000032", "Farah"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.admin").value(false))
                .andExpect(jsonPath("$.verifiedResidents").value(1));
    }

    @Test
    @DisplayName("an unknown society is a 404, not an empty membership")
    void unknownSociety() throws Exception {
        mvc.perform(get("/societies/no-such-society-at-all/membership"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the ops claim queue is staff-only")
    void claimQueueIsStaffOnly() throws Exception {
        mvc.perform(get("/admin/society-claims")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000033", "Gaurav"))))
                .andExpect(status().isForbidden());
        mvc.perform(get("/admin/society-claims")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000099")))
                .andExpect(status().isOk());
    }
}
