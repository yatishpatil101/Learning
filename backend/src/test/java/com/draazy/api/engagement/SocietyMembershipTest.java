package com.draazy.api.engagement;

import static org.assertj.core.api.Assertions.assertThat;
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
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;

// Partial unique index refuses a second verified resident; rejection frees the flat.
// The queue stays staff-only because it publishes names and mobiles.
@DisplayName("Societies — residents, claims and who reviews them")
class SocietyMembershipTest extends AbstractApiTest {

    @Autowired UserRepository users;

    // `AuditService.record` uses `REQUIRES_NEW`, so class rollback cannot clean it up.
    // Without cleanup, shared database reveal counts climb on every run.
    @BeforeAll
    static void removeRevealRowsLeftByAnEarlierRun(@Autowired JdbcTemplate jdbc) {
        sweepOwnAuditRows(jdbc);
    }

    @AfterAll
    static void removeRevealRowsThatEscapedRollback(@Autowired JdbcTemplate jdbc) {
        sweepOwnAuditRows(jdbc);
    }

    private static void sweepOwnAuditRows(JdbcTemplate jdbc) {
        jdbc.update("delete from audit_log where action = 'societyClaim.certificate.reveal'");
    }

    // No `@AfterAll`: class rollback covers these rows because none use `REQUIRES_NEW`.
    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private String staff(String mobile) {
        return staff(mobile, new String[0]);
    }

    private String staff(String mobile, String... permissions) {
        User u = new User(mobile, Roles.Wire.STAFF);
        u.setName("Ops " + mobile.substring(6));
        u.setMobileVerified(true);
    // Filtering out `community` keeps the offset stable against suite-wide mints.
        u = users.saveAndFlush(u);
        if (permissions.length > 0) {
            String json = "[\"" + String.join("\",\"", permissions) + "\"]";
            jdbc.update("insert into back_office_permissions(user_id, permissions) "
                    + "values (?::uuid, ?::jsonb)", u.getId().toString(), json);
        }
        return bearer(u);
    }

    private String society(int offset) {
        List<String> slugs = jdbc.queryForList(
                "select slug from societies where source <> 'community' order by slug offset ? limit 1",
                String.class, offset);
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

    @Test
    @DisplayName("an unclaimed society's requests go to ops; a claimed one's go to its committee, including those ops had not got to")
    void queueFollowsTheClaim() throws Exception {
        String slug = society(8);
        User waiting = user("9862000014", "Nilesh");
        apply(waiting, slug, "G", "1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedTo").value("ops"));

        approveClaim(claim(user("9862000015", "Omkar"), slug));

        mvc.perform(get("/societies/" + slug + "/hub")
                        .header(HttpHeaders.AUTHORIZATION, bearer(waiting)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.resident.assignedTo").value("committee"));

        apply(user("9862000016", "Pallavi"), slug, "G", "2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assignedTo").value("committee"));
    }

    @Test
    @DisplayName("the approved claimant reviews their own society; a neighbour does not")
    void onlyTheCommitteeOrStaffMayReview() throws Exception {
        String slug = society(10);
        User committee = user("9862000019", "Sneha");
        approveClaim(claim(committee, slug));

        User applicant = user("9862000020", "Tarun");
        String id = idOf(apply(applicant, slug, "J", "1").andExpect(status().isOk()));
        String committeeId = idOf(apply(user("9862000046", "Yash"), slug, "J", "2")
                .andExpect(status().isOk()));

        mvc.perform(get("/societies/" + slug + "/residents")
                        .header(HttpHeaders.AUTHORIZATION, bearer(applicant)))
                .andExpect(status().isForbidden());
        decide(bearer(applicant), slug, id, "verified").andExpect(status().isForbidden());

        decide(staff("9862000088", "support"), slug, id, "verified")
                .andExpect(status().isForbidden());
        decide(staff("9862000089", "content"), slug, id, "verified")
                .andExpect(status().isOk());
        decide(bearer(committee), slug, committeeId, "verified").andExpect(status().isOk());
    }

    @Test
    @DisplayName("the review queue publishes the applicant's name and mobile")
    void theReviewerSeesWhoIsAsking() throws Exception {
        String slug = society(11);
        apply(user("9862000021", "Urmila"), slug, "K", "1").andExpect(status().isOk());

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

    @Test
    @DisplayName("a stranger gets the society's facts and none of their own")
    void membershipIsPublicAndCallerAware() throws Exception {
        String slug = society(17);
        mvc.perform(get("/societies/" + slug + "/hub"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.societySlug").value(slug))
                .andExpect(jsonPath("$.membership.resident").doesNotExist())
                .andExpect(jsonPath("$.membership.admin").value(false))
                .andExpect(jsonPath("$.membership.verifiedResidents").value(0));
    }

    @Test
    @DisplayName("the public membership read never carries the claimant's mobile or email")
    void membershipWithholdsClaimantContact() throws Exception {
        String slug = society(18);
        claim(user("9862000029", "Chirag"), slug);

        mvc.perform(get("/societies/" + slug + "/hub"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.claim.status").value("pending"))
                .andExpect(jsonPath("$.membership.claim.claimantName").value("Committee Member"))
                .andExpect(jsonPath("$.membership.claim.claimantMobile").doesNotExist())
                .andExpect(jsonPath("$.membership.claim.email").doesNotExist());
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

        mvc.perform(get("/societies/" + slug + "/hub")
                        .header(HttpHeaders.AUTHORIZATION, bearer(committee)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.admin").value(true))
                .andExpect(jsonPath("$.membership.verifiedResidents").value(1));

        mvc.perform(get("/societies/" + slug + "/hub")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000032", "Farah"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membership.admin").value(false))
                .andExpect(jsonPath("$.membership.verifiedResidents").value(1));
    }

    @Test
    @DisplayName("an unknown society is a 404, not an empty membership")
    void unknownSociety() throws Exception {
        mvc.perform(get("/societies/no-such-society-at-all/hub"))
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

    private String vaultDocument(User owner) {
        return jdbc.queryForObject("""
                insert into personal_documents (owner_id, category, file_name, storage_key)
                values (?, 'Society Registration Certificate', 'reg-cert.pdf', ?)
                returning id::text
                """, String.class, owner.getId(), "personal/" + owner.getId() + "/" + UUID.randomUUID());
    }

    @Test
    @DisplayName("registration number and certificate reach the ops queue that has to check them")
    void proofRoundTripsToTheQueue() throws Exception {
        String slug = society(20);
        User u = user("9862000034", "Harshad");
        String docId = vaultDocument(u);

        String claimId = idOf(mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Harshad Pawar\",\"role\":\"Secretary\","
                                + "\"registrationNo\":\"PNA/(PNA)/HSG/(TC)/1234/2015\","
                                + "\"certificateDocumentId\":\"" + docId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.registrationNo").value("PNA/(PNA)/HSG/(TC)/1234/2015"))
                .andExpect(jsonPath("$.certificateDocumentId").value(docId)));

        // The queue is the reviewer surface; a field only echoed on POST
        // would still leave the reviewer with nothing.
        mvc.perform(get("/admin/society-claims").param("status", "pending")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000097")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.id == '" + claimId + "')].registrationNo")
                        .value("PNA/(PNA)/HSG/(TC)/1234/2015"))
                .andExpect(jsonPath("$.content[?(@.id == '" + claimId + "')].certificateDocumentId")
                        .value(docId));
    }

    @Test
    @DisplayName("a committee with no paperwork to hand can still file a claim")
    void proofIsOptional() throws Exception {
        String slug = society(21);
        mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000035", "Ira")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Ira Sathe\",\"role\":\"Chairman\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.registrationNo").doesNotExist())
                .andExpect(jsonPath("$.certificateDocumentId").doesNotExist());
    }

    @Test
    @DisplayName("an over-long registration number is refused rather than truncated into the column")
    void registrationNumberIsCapped() throws Exception {
        String slug = society(22);
        mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000036", "Jatin")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Jatin Rane\",\"registrationNo\":\""
                                + "P".repeat(81) + "\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("a certificate from somebody else's vault is refused, and says nothing about it")
    void certificateMustBeTheClaimantsOwn() throws Exception {
        String slug = society(23);
        String someoneElses = vaultDocument(user("9862000037", "Kavya"));

        mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000038", "Lalit")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Lalit Shah\",\"certificateDocumentId\":\""
                                + someoneElses + "\"}"))
                .andExpect(status().isBadRequest())

                // The same answer an unknown id gets. Distinguishing the two would confirm that a
                // stranger's document exists, which is the enumeration this endpoint must not do.
                .andExpect(jsonPath("$.message")
                        .value("certificateDocumentId is not a document in your vault"));

        mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(user("9862000039", "Manav")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Manav Rao\",\"certificateDocumentId\":\""
                                + UUID.randomUUID() + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message")
                        .value("certificateDocumentId is not a document in your vault"));
    }

    private String claimWithCertificate(String slug, User u, String docId) throws Exception {
        String body = docId == null
                ? "{\"name\":\"" + u.getName() + "\"}"
                : "{\"name\":\"" + u.getName() + "\",\"certificateDocumentId\":\"" + docId + "\"}";
        return idOf(mvc.perform(post("/societies/" + slug + "/claim")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk()));
    }

    @Test
    @DisplayName("a reviewer can open the certificate attached to a claim")
    void certificateIsReadableFromTheClaim() throws Exception {
        String slug = society(24);
        User u = user("9862000040", "Nikhil");
        String docId = vaultDocument(u);
        String claimId = claimWithCertificate(slug, u, docId);

        mvc.perform(get("/admin/society-claims/" + claimId + "/certificate")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000091")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").isNotEmpty())
                .andExpect(jsonPath("$.fileName").value("reg-cert.pdf"))

                // The id is deliberately absent from the response.
                .andExpect(jsonPath("$.certificateDocumentId").doesNotExist())
                .andExpect(jsonPath("$.storageKey").doesNotExist());

        // Staff viewed a private document; the audit row is the later answer.
        assertThat(jdbc.queryForObject("""
                select count(*) from audit_log
                where action = 'societyClaim.certificate.reveal' and entity_id = ?
                """, Integer.class, claimId)).isEqualTo(1);
    }

    @Test
    @DisplayName("a claim with no certificate, an unknown claim and a stranger's document all 404")
    void certificateSaysNothingItDoesNotHaveTo() throws Exception {
        String slug = society(25);
        User u = user("9862000041", "Oorja");

        String bare = claimWithCertificate(slug, u, null);
        mvc.perform(get("/admin/society-claims/" + bare + "/certificate")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000092")))
                .andExpect(status().isNotFound());

        mvc.perform(get("/admin/society-claims/" + UUID.randomUUID() + "/certificate")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000093")))
                .andExpect(status().isNotFound());

        // Later deletion or transfer can stale a once-valid id;
        // reads must not serve links from old checks.
        String docId = vaultDocument(u);
        String claimId = claimWithCertificate(society(26), u, docId);
        jdbc.update("update personal_documents set owner_id = ? where id = ?::uuid",
                user("9862000042", "Pranav").getId(), docId);
        mvc.perform(get("/admin/society-claims/" + claimId + "/certificate")
                        .header(HttpHeaders.AUTHORIZATION, staff("9862000094")))

                // Separating these cases would reveal whether a forbidden document exists.
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the certificate is staff-only, like the queue it hangs off")
    void certificateIsNotPublic() throws Exception {
        String slug = society(27);
        User u = user("9862000043", "Ruchi");
        String claimId = claimWithCertificate(slug, u, vaultDocument(u));

        // Not even the claimant, through this route. They can already read their own vault; what
        // must not exist is a second door into it that only checks the claim.
        mvc.perform(get("/admin/society-claims/" + claimId + "/certificate")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isForbidden());

        mvc.perform(get("/admin/society-claims/" + claimId + "/certificate"))
                .andExpect(status().isUnauthorized());
    }
}
