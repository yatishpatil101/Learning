package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@TestPropertySource(properties = "draazy.identity.qa-sample-rate=0.0")
class IdentityReviewClaimQaTest extends AbstractApiTest {

    private static final String PAN = "ABCDE1234F";
    private static final String REVOKE_REASON = "The approved document failed the second review";

    @Autowired
    UserRepository users;

    @Autowired
    IdentityVerificationRepository verifications;

    @Autowired
    LivenessCheck livenessCheck;

    @AfterEach
    void cleanAuditRows() {
        jdbc.update("delete from audit_log where action in ("
                + "'identity.verification.approved',"
                + "'identity.verification.revoked',"
                + "'identity.review.claimed',"
                + "'identity.review.released',"
                + "'identity.claim.force_released',"
                + "'identity.review.qa_confirmed',"
                + "'identity.review.qa_revoked',"
                + "'user.name.set_from_identity')");
    }

    @Test
    void approveSetsTheAccountNameAuditsItAndDoesNotSamplePassedLivenessAtZeroRate() throws Exception {
        User subject = user("9830011001", "buyer", "Old Profile Name");
        User reviewer = user("9830011002", Roles.Wire.ADMIN, "Ops Admin A");
        submitPan(subject, "passed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);

        mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountName").value("Old Profile Name"));

        approve(reviewer, id, "  Asha   Legal  Patil ")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.holderName").value("Asha Legal Patil"))
                .andExpect(jsonPath("$.accountName").value("Asha Legal Patil"))
                .andExpect(jsonPath("$.livenessSource").value("challenge"))
                .andExpect(jsonPath("$.qaSampledAt").doesNotExist());

        assertThat(users.findById(subject.getId()).orElseThrow().getName())
                .isEqualTo("Asha Legal Patil");
        assertThat(jdbc.queryForObject("""
                select metadata ->> 'before'
                  from audit_log
                 where action = 'user.name.set_from_identity'
                   and entity_id = ?
                  order by at desc
                  limit 1
                """, String.class, subject.getId().toString()))
                .isEqualTo("Old Profile Name");
        assertThat(jdbc.queryForObject("""
                select metadata ->> 'after'
                  from audit_log
                 where action = 'user.name.set_from_identity'
                   and entity_id = ?
                  order by at desc
                  limit 1
                """, String.class, subject.getId().toString()))
                .isEqualTo("Asha Legal Patil");
        assertThat(jdbc.queryForObject("""
                select body
                  from notifications
                 where user_id = ? and type = 'identity.approved'
                  order by created_at desc
                  limit 1
                """, String.class, subject.getId()))
                .contains("Your profile name now matches your ID: Asha Legal Patil");
    }

    @Test
    void approvalNameIsNfcSeparatorNormalisedAndRejectsUnsafeNames() throws Exception {
        User subject = user("9830011021", "buyer", "Old Profile Name");
        User reviewer = user("9830011022", Roles.Wire.ADMIN, "Ops Admin A");
        submitPan(subject, "passed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);

        approve(reviewer, id, "Cafe\u0301\u00A0\u00A0Patil")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.holderName").value("Café Patil"));

        User marathiSubject = user("9830011034", "buyer", "Marathi Name Subject");
        submitPan(marathiSubject, "passed", "ABCDE1237I").andExpect(status().isAccepted());
        approve(reviewer, caseOf(marathiSubject), "श्री\u200Dकांत पाटील", "ABCDE1237I")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.holderName").value("श्री\u200Dकांत पाटील"));

        User unsafeSubject = user("9830011023", "buyer", "Unsafe Name Subject");
        submitPan(unsafeSubject, "passed", "ABCDE1235G").andExpect(status().isAccepted());
        approve(reviewer, caseOf(unsafeSubject), "Bad\\u0001Name", "ABCDE1235G")
                .andExpect(status().isBadRequest());

        User leadingJoinerSubject = user("9830011035", "buyer", "Leading Joiner Subject");
        submitPan(leadingJoinerSubject, "passed", "ABCDE1238J").andExpect(status().isAccepted());
        approve(reviewer, caseOf(leadingJoinerSubject), "\u200Dश्रीकांत", "ABCDE1238J")
                .andExpect(status().isBadRequest());

        User trailingJoinerSubject = user("9830011036", "buyer", "Trailing Joiner Subject");
        submitPan(trailingJoinerSubject, "passed", "ABCDE1239K").andExpect(status().isAccepted());
        approve(reviewer, caseOf(trailingJoinerSubject), "श्रीकांत\u200D", "ABCDE1239K")
                .andExpect(status().isBadRequest());

        User longSubject = user("9830011024", "buyer", "Long Name Subject");
        submitPan(longSubject, "passed", "ABCDE1236H").andExpect(status().isAccepted());
        approve(reviewer, caseOf(longSubject), "A".repeat(81), "ABCDE1236H")
                .andExpect(status().isBadRequest());
    }

    @Test
    void freshClaimBlocksAnotherReviewerClaimAndApproveThenDecisionClearsIt() throws Exception {
        User subject = user("9830011003", "buyer", "Claim Subject");
        User first = user("9830011004", Roles.Wire.ADMIN, "Ops Admin A");
        User second = user("9830011005", Roles.Wire.ADMIN, "Ops Admin B");
        submitPan(subject, "passed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);

        claim(first, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claimedByName").value("Ops Admin A"))
                .andExpect(jsonPath("$.claimedByMe").value(true))
                .andExpect(jsonPath("$.length()").value(2));
        Instant claimedAt = verifications.findById(id).orElseThrow().getClaimedAt();
        claim(first, id).andExpect(status().isOk());
        assertThat(verifications.findById(id).orElseThrow().getClaimedAt()).isEqualTo(claimedAt);
        claim(second, id)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_CASE_CLAIMED));
        approve(second, id, "Asha Patil")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_CASE_CLAIMED));

        approve(first, id, "Asha Patil").andExpect(status().isOk());
        IdentityVerification row = verifications.findById(id).orElseThrow();
        assertThat(row.getClaimedBy()).isNull();
        assertThat(row.getClaimedAt()).isNull();
    }

    @Test
    void reviewerClaimLimitCanBeForceReleasedByAdmin() throws Exception {
        User reviewer = user("9830011025", Roles.Wire.ADMIN, "Ops Admin A");
        User forceAdmin = user("9830011026", Roles.Wire.ADMIN, "Ops Admin B");
        UUID first = pendingCase("9830011027", "Claim Limit Subject 1");
        UUID second = pendingCase("9830011028", "Claim Limit Subject 2");
        UUID third = pendingCase("9830011029", "Claim Limit Subject 3");
        UUID fourth = pendingCase("9830011030", "Claim Limit Subject 4");

        claim(reviewer, first).andExpect(status().isOk());
        claim(reviewer, second).andExpect(status().isOk());
        claim(reviewer, third).andExpect(status().isOk());
        claim(reviewer, fourth)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_CASE_CLAIM_LIMIT));

        forceRelease(forceAdmin, first)
                .andExpect(status().isNoContent())
                .andExpect(content().string(""));
        assertThat(auditCount("identity.claim.force_released", first)).isEqualTo(1);
        claim(reviewer, fourth).andExpect(status().isOk());
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void concurrentClaimsByTheSameReviewerAreCappedAtThree() throws Exception {
        List<String> mobiles = List.of("9830011040", "9830011041", "9830011042",
                "9830011043", "9830011044", "9830011045");
        ExecutorService pool = Executors.newFixedThreadPool(5);
        try {
            User reviewer = user(mobiles.get(0), Roles.Wire.ADMIN, "Ops Admin A");
            List<UUID> ids = new ArrayList<>();
            for (int i = 1; i < mobiles.size(); i++) {
                ids.add(pendingCase(mobiles.get(i), "Concurrent Claim Subject " + i));
            }
            String token = bearer(reviewer);
            CountDownLatch ready = new CountDownLatch(ids.size());
            CountDownLatch start = new CountDownLatch(1);
            List<Future<Integer>> results = new ArrayList<>();
            for (UUID id : ids) {
                results.add(pool.submit(() -> {
                    ready.countDown();
                    start.await(5, TimeUnit.SECONDS);
                    return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim", id))
                                    .header(HttpHeaders.AUTHORIZATION, token))
                            .andReturn()
                            .getResponse()
                            .getStatus();
                }));
            }

            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> result : results) {
                statuses.add(result.get(30, TimeUnit.SECONDS));
            }

            assertThat(statuses.stream().filter(s -> s == 200).count()).isEqualTo(3);
            assertThat(statuses.stream().filter(s -> s == 409).count()).isEqualTo(2);
            assertThat(verifications.countByClaimedByAndStatusAndClaimedAtAfter(
                    reviewer.getId(), VerificationStatuses.PENDING, Instant.now().minus(30, ChronoUnit.MINUTES)))
                    .isEqualTo(3);
        } finally {
            pool.shutdownNow();
            deleteUsersByMobile(mobiles);
        }
    }

    @Test
    void staleClaimIsTakeableAndReleaseOnlyAllowsHolderOrStaleClaims() throws Exception {
        User subject = user("9830011006", "buyer", "Release Subject");
        User first = user("9830011007", Roles.Wire.ADMIN, "Ops Admin A");
        User second = user("9830011008", Roles.Wire.ADMIN, "Ops Admin B");
        submitPan(subject, "passed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);

        claim(first, id).andExpect(status().isOk());
        release(second, id).andExpect(status().isConflict());

        IdentityVerification row = verifications.findById(id).orElseThrow();
        row.setClaimedAt(Instant.now().minus(31, ChronoUnit.MINUTES));
        verifications.saveAndFlush(row);

        claim(second, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claimedByName").value("Ops Admin B"))
                .andExpect(jsonPath("$.claimedByMe").value(true));
        release(first, id).andExpect(status().isConflict());

        IdentityVerification stale = verifications.findById(id).orElseThrow();
        stale.setClaimedAt(Instant.now().minus(31, ChronoUnit.MINUTES));
        verifications.saveAndFlush(stale);

        release(first, id)
                .andExpect(status().isNoContent())
                .andExpect(content().string(""));
        assertThat(verifications.findById(id).orElseThrow().getClaimedBy()).isNull();
    }

    @Test
    void bypassedLivenessIsSampledAndAnotherStafferCanConfirmQa() throws Exception {
        User subject = user("9830011009", "buyer", "QA Subject");
        User approver = user("9830011010", Roles.Wire.ADMIN, "Ops Admin A");
        User checker = user("9830011011", Roles.Wire.ADMIN, "Ops Admin B");
        submitPan(subject, "bypassed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);

        approve(approver, id, "Asha Patil")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.qaSampledAt").doesNotExist())
                .andExpect(jsonPath("$.livenessSource").value("challenge"))
                .andExpect(jsonPath("$.approvedByName").value("Ops Admin A"));

        mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(approver)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.qaSampledAt").doesNotExist())
                .andExpect(jsonPath("$.awaitingQa").value(true))
                .andExpect(jsonPath("$.qaOutcome").doesNotExist())
                .andExpect(jsonPath("$.qaReviewedByName").doesNotExist());
        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS).param("status", "qa")
                        .header(HttpHeaders.AUTHORIZATION, bearer(approver)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS).param("status", "qa")
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(id.toString()))
                .andExpect(jsonPath("$.content[0].qaSampledAt").exists())
                .andExpect(jsonPath("$.content[0].approvedByName").value("Ops Admin A"));

        revoke(approver, id)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_QA_OPEN));
        qa(approver, id, "{\"outcome\":\"confirmed\"}")
                .andExpect(status().isForbidden());
        qa(checker, id, "{\"outcome\":\"confirmed\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.qaOutcome").value("confirmed"))
                .andExpect(jsonPath("$.qaReviewedByName").value("Ops Admin B"))
                .andExpect(jsonPath("$.awaitingQa").value(false));

        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS).param("status", "qa")
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void resubmittedPassedLivenessCaseIsSampledForQaAtZeroRate() throws Exception {
        User subject = user("9830011031", "buyer", "Resubmit Subject");
        User reviewer = user("9830011032", Roles.Wire.ADMIN, "Ops Admin A");
        User checker = user("9830011033", Roles.Wire.ADMIN, "Ops Admin B");
        submitPan(subject, "passed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);
        reject(reviewer, id).andExpect(status().isOk());
        submitPan(subject, "passed").andExpect(status().isAccepted());

        approve(reviewer, id, "Asha Patil").andExpect(status().isOk());

        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS).param("status", "qa")
                        .header(HttpHeaders.AUTHORIZATION, bearer(checker)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(id.toString()));
    }

    @Test
    void qaRevokeRunsTheRevokePathAndRecordsQaOutcome() throws Exception {
        User subject = user("9830011012", "buyer", "QA Revoke Subject");
        User approver = user("9830011013", Roles.Wire.ADMIN, "Ops Admin A");
        User checker = user("9830011014", Roles.Wire.ADMIN, "Ops Admin B");
        submitPan(subject, "bypassed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);
        approve(approver, id, "Asha Patil").andExpect(status().isOk());

        qa(checker, id, "{\"outcome\":\"revoked\",\"reason\":\"" + REVOKE_REASON + "\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REVOKED))
                .andExpect(jsonPath("$.qaOutcome").value("revoked"))
                .andExpect(jsonPath("$.revocationReason").value(REVOKE_REASON));

        assertThat(users.findById(subject.getId()).orElseThrow().isVerified()).isFalse();
        assertThat(verifications.findById(id).orElseThrow().getRevokedBy()).isEqualTo(checker.getId());
        assertThat(auditCount("identity.review.qa_revoked", id)).isEqualTo(1);
        assertThat(auditCount("identity.verification.revoked", id)).isEqualTo(1);
    }

    @Test
    void qaOnAnUnsampledCaseIsAConflict() throws Exception {
        User subject = user("9830011015", "buyer", "Unsampled Subject");
        User approver = user("9830011016", Roles.Wire.ADMIN, "Ops Admin A");
        User checker = user("9830011017", Roles.Wire.ADMIN, "Ops Admin B");
        submitPan(subject, "passed").andExpect(status().isAccepted());
        UUID id = caseOf(subject);
        approve(approver, id, "Asha Patil").andExpect(status().isOk());

        qa(checker, id, "{\"outcome\":\"confirmed\"}")
                .andExpect(status().isConflict());
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static MockMultipartFile png(String field) {
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        return new MockMultipartFile(field, field + ".png", "image/png", pngMagic);
    }

    private MockMultipartHttpServletRequestBuilder submission(User user, String liveness) {
        return submission(user, liveness, PAN);
    }

    private MockMultipartHttpServletRequestBuilder submission(User user, String liveness, String number) {
        return multipart(Routes.Verification.IDENTITY)
                .file(png("front"))
                .file(png("selfie"))
                .param("docType", IdentityDocTypes.PAN)
                .param("consent", "true")
                .param("claims", "{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}")
                .param("liveness", liveness)
                .param("challenge", livenessCheck.issue(user.getId()).token())
                .header(HttpHeaders.AUTHORIZATION, bearer(user));
    }

    private ResultActions submitPan(User user, String liveness) throws Exception {
        return mvc.perform(submission(user, liveness));
    }

    private ResultActions submitPan(User user, String liveness, String number) throws Exception {
        return mvc.perform(submission(user, liveness, number));
    }

    private UUID caseOf(User user) {
        return verifications.findByUserId(user.getId()).orElseThrow().getId();
    }

    private UUID pendingCase(String mobile, String name) throws Exception {
        User subject = user(mobile, "buyer", name);
        submitPan(subject, "passed").andExpect(status().isAccepted());
        return caseOf(subject);
    }

    private String reviewPath(String route, UUID id) {
        return route.replace("{id}", id.toString());
    }

    private ResultActions approve(User reviewer, UUID id, String name) throws Exception {
        return approve(reviewer, id, name, PAN);
    }

    private ResultActions approve(User reviewer, UUID id, String name, String number) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_APPROVE, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"number\":\"" + number + "\",\"name\":\"" + name + "\",\"dob\":\"1991-04-12\",\"poseConfirmed\":true}"));
    }

    private ResultActions reject(User reviewer, UUID id) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REJECT, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"blurry\",\"note\":\"The image is too blurry to verify\"}"));
    }

    private ResultActions revoke(User reviewer, UUID id) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REVOKE, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"" + REVOKE_REASON + "\"}"));
    }

    private ResultActions claim(User reviewer, UUID id) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim", id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)));
    }

    private ResultActions release(User reviewer, UUID id) throws Exception {
        return mvc.perform(delete(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim", id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)));
    }

    private ResultActions forceRelease(User reviewer, UUID id) throws Exception {
        return mvc.perform(delete(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim", id))
                .param("force", "true")
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)));
    }

    private ResultActions qa(User reviewer, UUID id, String body) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/qa", id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private int auditCount(String action, UUID id) {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = ? and entity_id = ?",
                Integer.class, action, id.toString());
    }

    private void deleteUsersByMobile(List<String> mobiles) {
        String in = String.join(",", Collections.nCopies(mobiles.size(), "?"));
        Object[] args = mobiles.toArray();
        jdbc.update("delete from identity_verification_files where verification_id in "
                + "(select v.id from identity_verifications v join users u on u.id = v.user_id "
                + "where u.mobile in (" + in + "))", args);
        jdbc.update("delete from notifications where user_id in "
                + "(select id from users where mobile in (" + in + "))", args);
        jdbc.update("delete from identity_conflicts where user_id in "
                + "(select id from users where mobile in (" + in + "))", args);
        jdbc.update("delete from identity_verifications where user_id in "
                + "(select id from users where mobile in (" + in + "))", args);
        jdbc.update("delete from users where mobile in (" + in + ")", args);
    }
}
