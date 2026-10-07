package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

@TestPropertySource(properties = "draazy.identity.qa-sample-rate=0.0")
class VerificationEndpointsTest extends AbstractApiTest {

    private static final String PAN = "ABCDE1234F";
    private static final String OTHER_PAN = "FGHIJ5678K";

    @Autowired
    UserRepository users;
    @Autowired
    IdentityVerificationRepository verifications;
    @Autowired
    IdentityVerificationFileRepository files;
    @Autowired
    LivenessCheck livenessCheck;
    @Autowired
    IdentityVerificationService service;

    @AfterEach
    void cleanAuditRows() {
        jdbc.update("delete from audit_log where action like 'identity.verification.%'");
    }

    private User user(String mobile) {
        return person(mobile, Roles.Wire.BUYER, "Asha Patil");
    }

    private User admin(String mobile) {
        return person(mobile, Roles.Wire.ADMIN, "Ops Admin");
    }

    private User person(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static MockMultipartFile png(String field) {
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        return new MockMultipartFile(field, field + ".png", "image/png", pngMagic);
    }

    private static String claims(String number) {
        return "{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}";
    }

    /** A Verhoeff-valid Aadhaar built from an 11-digit body, so the check digit is never guessed. */
    static String validAadhaar(String body) {
        for (char d = '0'; d <= '9'; d++) {
            if (IdentityNumbers.verhoeffValid(body + d)) {
                return body + d;
            }
        }
        throw new IllegalStateException("no Verhoeff digit completes " + body);
    }

    private MockMultipartHttpServletRequestBuilder submission(User u, String docType, boolean back) {
        MockMultipartHttpServletRequestBuilder b = multipart(Routes.Verification.IDENTITY)
                .file(png("front"))
                .file(png("selfie"))
                .param("docType", docType)
                .param("consent", "true")
                .header(HttpHeaders.AUTHORIZATION, bearer(u));
        return back ? b.file(png("back")) : b;
    }

    private ResultActions submitPan(User u, String number) throws Exception {
        return mvc.perform(submission(u, IdentityDocTypes.PAN, false)
                .param("claims", claims(number))
                .param("liveness", "passed")
                .param("challenge", livenessCheck.issue(u.getId()).token()));
    }

    private UUID caseOf(User u) {
        return verifications.findByUserId(u.getId()).orElseThrow().getId();
    }

    private String reviewPath(String route, UUID id) {
        return route.replace("{id}", id.toString());
    }

    private ResultActions approve(User reviewer, UUID id, String number) throws Exception {
        return approveBody(reviewer, id, "{\"number\":\"" + number
                + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\",\"poseConfirmed\":true}");
    }

    private ResultActions approveBody(User reviewer, UUID id, String body) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_APPROVE, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions reject(User reviewer, UUID id) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REJECT, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"blurry\",\"note\":\"Retake in better light\"}"));
    }

    private ResultActions revoke(User reviewer, UUID id, String reason) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REVOKE, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"" + reason + "\"}"));
    }

    private int auditCount(String action, UUID id) {
        return jdbc.queryForObject(
                "select count(*) from audit_log where action = ? and entity_id = ?",
                Integer.class, action, id.toString());
    }

    @Test
    void getStatus_returnsTheNoCaseStateRatherThan404() throws Exception {
        User u = user("9830000001");

        mvc.perform(get(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.NONE))
                .andExpect(jsonPath("$.docType").doesNotExist());
    }

    @Test
    void submit_returns202_storesThreeImages_andKeepsOnlyLast4OfTheClaim() throws Exception {
        User u = user("9830000002");
        String aadhaar = validAadhaar("98300000021");

        mvc.perform(submission(u, IdentityDocTypes.AADHAAR, true)
                        .param("claims", claims(aadhaar))
                        .param("liveness", "passed"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.PENDING))
                .andExpect(jsonPath("$.docType").value(IdentityDocTypes.AADHAAR))
                .andExpect(jsonPath("$.submittedAt").exists());

        IdentityVerification row = verifications.findByUserId(u.getId()).orElseThrow();
        assertThat(row.getStatus()).isEqualTo(VerificationStatuses.PENDING);
        assertThat(row.getAttemptCount()).isEqualTo(1);
        assertThat(row.getClaimedNumberLast4()).isEqualTo(aadhaar.substring(8));
        assertThat(row.getClaimedHash()).isNotBlank();
        assertThat(row.getIdentityHash()).as("the dedup key is set at approval, never from OCR").isNull();
        assertThat(row.getLiveness()).isEqualTo("passed");
        assertThat(row.getConsentNoticeVersion()).isEqualTo(IdentityVerificationService.CONSENT_NOTICE_VERSION);
        assertThat(files.findByVerificationId(row.getId()))
                .extracting(IdentityVerificationFile::getKind)
                .containsExactlyInAnyOrder(IdentityVerificationFile.FRONT,
                        IdentityVerificationFile.BACK, IdentityVerificationFile.SELFIE);
    }

    @Test
    void submit_enforcesTheBackRulePerDocument() throws Exception {
        User u = user("9830000003");

        mvc.perform(submission(u, IdentityDocTypes.PAN, true))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(submission(u, IdentityDocTypes.AADHAAR, false))
                .andExpect(status().isUnprocessableEntity());

        mvc.perform(submission(u, IdentityDocTypes.DRIVING_LICENCE, true))
                .andExpect(status().isUnprocessableEntity());
        assertThat(verifications.findByUserId(u.getId())).isEmpty();
    }

    @Test
    void submit_acceptsPassportFrontOnly_andRequiresVoterIdBack() throws Exception {
        User passportHolder = user("9830000037");
        User voter = user("9830000038");

        mvc.perform(submission(passportHolder, IdentityDocTypes.PASSPORT, false)
                        .param("claims", claims("A1234567")))
                .andExpect(status().isAccepted());
        mvc.perform(submission(voter, IdentityDocTypes.VOTER_ID, false)
                        .param("claims", claims("ABC1234567")))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(submission(voter, IdentityDocTypes.VOTER_ID, true)
                        .param("claims", claims("ABC1234567")))
                .andExpect(status().isAccepted());
    }

    @Test
    void submit_refusesWithoutConsent_orASelfie_orAnUnknownDocument() throws Exception {
        User u = user("9830000004");

        mvc.perform(multipart(Routes.Verification.IDENTITY).file(png("front")).file(png("selfie"))
                .param("docType", IdentityDocTypes.PAN).param("consent", "false")
                .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(multipart(Routes.Verification.IDENTITY).file(png("front"))
                        .param("docType", IdentityDocTypes.PAN).param("consent", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isUnprocessableEntity());
        mvc.perform(submission(u, "ration_card", false))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void submit_refusesAnythingThatIsNotAPhoto_byContentNotByHeader() throws Exception {
        User u = user("9830000005");
        MockMultipartFile pdfDisguised = new MockMultipartFile("front", "front.png", "image/png",
                "%PDF-1.4 not a photo".getBytes());

        mvc.perform(multipart(Routes.Verification.IDENTITY)
                        .file(pdfDisguised).file(png("selfie"))
                        .param("docType", IdentityDocTypes.PAN).param("consent", "true")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void submit_whileACaseIsPending_is409() throws Exception {
        User u = user("9830000006");
        submitPan(u, PAN).andExpect(status().isAccepted());

        submitPan(u, PAN).andExpect(status().isConflict());
    }

    @Test
    void verificationRoutesRequireAuthentication() throws Exception {
        mvc.perform(get(Routes.Verification.IDENTITY)).andExpect(status().isUnauthorized());
        mvc.perform(multipart(Routes.Verification.IDENTITY).file(png("front")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void approve_grantsTheBadge_storesOnlyLast4_andHashesTheReviewersNumber() throws Exception {
        User u = user("9830000010");
        User reviewer = admin("9830000011");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);

        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
            .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].claims.number").value(PAN.substring(6)))
            .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].userMobile").value("9830000010"));

        mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.userMobile").value("9830000010"))
            .andExpect(jsonPath("$.images.front").exists())
            .andExpect(jsonPath("$.images.selfie").exists());
        assertThat(auditCount("identity.verification.viewed", id)).isEqualTo(1);

        approve(reviewer, id, PAN)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED))
                .andExpect(jsonPath("$.docLast4").value(PAN.substring(6)))
                .andExpect(jsonPath("$.holderName").value("Asha Patil"));

        IdentityVerification row = verifications.findById(id).orElseThrow();
        assertThat(row.getIdentityHash()).isNotBlank().doesNotContain(PAN);
        assertThat(row.getReviewerId()).isEqualTo(reviewer.getId());
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isTrue();
        assertThat(auditCount("identity.verification.approved", id)).isEqualTo(1);

        mvc.perform(get(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED))
                .andExpect(jsonPath("$.docLast4").value(PAN.substring(6)))
                .andExpect(jsonPath("$.attemptsRemaining").value(0));
    }

    @Test
    void approve_refusesAMalformedNumber_andADecidedCase() throws Exception {
        User u = user("9830000012");
        User reviewer = admin("9830000013");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);

        approve(reviewer, id, "not-a-pan").andExpect(status().isUnprocessableEntity());
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isFalse();

        approve(reviewer, id, PAN).andExpect(status().isOk());
        approve(reviewer, id, PAN).andExpect(status().isConflict());
        reject(reviewer, id).andExpect(status().isConflict());
    }

    @Test
    void approve_requiresExactlyOneAdultDobOrBirthYear() throws Exception {
        User u = user("9830000043");
        User reviewer = admin("9830000044");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);

        approveBody(reviewer, id, "{\"number\":\"" + PAN + "\",\"name\":\"Asha Patil\"}")
                .andExpect(status().isBadRequest());
        approveBody(reviewer, id, "{\"number\":\"" + PAN
                + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\",\"birthYear\":1991}")
                .andExpect(status().isBadRequest());
        approveBody(reviewer, id, "{\"number\":\"" + PAN + "\",\"name\":\"Asha Patil\",\"dob\":\""
                + LocalDate.now().plusDays(1) + "\"}")
                .andExpect(status().isBadRequest());
        approveBody(reviewer, id, "{\"number\":\"" + PAN + "\",\"name\":\"Asha Patil\",\"dob\":\"2010-01-01\"}")
                .andExpect(status().isBadRequest());
        approveBody(reviewer, id, "{\"number\":\"" + PAN + "\",\"name\":\"Asha Patil\",\"birthYear\":"
                + (LocalDate.now().getYear() - 18) + "}")
                .andExpect(status().isBadRequest());
        approveBody(reviewer, id, "{\"number\":\"" + PAN + "\",\"name\":\"Asha Patil\",\"birthYear\":1991,\"poseConfirmed\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.holderDob").value("1991-01-01"))
                .andExpect(jsonPath("$.holderDobYearOnly").value(true));
    }

    @Test
    void approve_enforcesPassportAndVoterIdNumberRules() throws Exception {
        User passportHolder = user("9830000040");
        User voter = user("9830000041");
        User reviewer = admin("9830000042");
        mvc.perform(submission(passportHolder, IdentityDocTypes.PASSPORT, false))
                .andExpect(status().isAccepted());
        mvc.perform(submission(voter, IdentityDocTypes.VOTER_ID, true))
                .andExpect(status().isAccepted());

        approve(reviewer, caseOf(passportHolder), "AA123456").andExpect(status().isUnprocessableEntity());
        approve(reviewer, caseOf(passportHolder), "A1234567").andExpect(status().isOk());
        approve(reviewer, caseOf(voter), "AB12345678").andExpect(status().isUnprocessableEntity());
        approve(reviewer, caseOf(voter), "ABC1234567").andExpect(status().isOk());
    }

    @Test
    void reject_opensARetry_withTheReasonAndRemainingAttemptsVisibleToTheUser() throws Exception {
        User u = user("9830000014");
        User reviewer = admin("9830000015");
        submitPan(u, PAN).andExpect(status().isAccepted());

        reject(reviewer, caseOf(u))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REJECTED))
                .andExpect(jsonPath("$.rejectionReason").value("blurry"));
        assertThat(auditCount("identity.verification.rejected", caseOf(u))).isEqualTo(1);

        mvc.perform(get(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REJECTED))
                .andExpect(jsonPath("$.rejectionNote").value("Retake in better light"))
                .andExpect(jsonPath("$.attemptsRemaining").value(2));

        UUID before = caseOf(u);
        submitPan(u, PAN).andExpect(status().isAccepted());
        assertThat(caseOf(u)).isEqualTo(before);
        assertThat(verifications.findById(before).orElseThrow().getAttemptCount()).isEqualTo(2);
        assertThat(files.findByVerificationId(before)).hasSize(2);
    }

    @Test
    void reject_requiresNotesForSensitiveReasons_andRejectsNotReviewedFromStaff() throws Exception {
        User u = user("9830000045");
        User reviewer = admin("9830000046");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);

        mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REJECT, id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"mismatch\",\"note\":\"short\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REJECT, id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"not_reviewed\",\"note\":\"system only\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REJECT, id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"not_holder\",\"note\":\"Face and card clearly differ\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void revoke_clearsTheBadgeAndRequiresAVerifiedCase() throws Exception {
        User u = user("9830000047");
        User reviewer = admin("9830000048");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);

        revoke(reviewer, id, "The approved document was disputed")
                .andExpect(status().isConflict());
        approve(reviewer, id, PAN).andExpect(status().isOk());
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isTrue();

        revoke(reviewer, id, " too short ")
                .andExpect(status().isBadRequest());
        revoke(reviewer, id, "The approved document was disputed")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REVOKED))
                .andExpect(jsonPath("$.revocationReason").value("The approved document was disputed"))
                .andExpect(jsonPath("$.revokedAt").exists())
                .andExpect(jsonPath("$.revokedByName").value("Ops Admin"));
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isFalse();
        assertThat(auditCount("identity.verification.revoked", id)).isEqualTo(1);

        mvc.perform(get(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REVOKED))
                .andExpect(jsonPath("$.revocationReason").value("The approved document was disputed"))
                .andExpect(jsonPath("$.revokedAt").exists());
    }

    @Test
    void theFourthAttemptInsideTheWindowIs429WithARetryAfter() throws Exception {
        User u = user("9830000016");
        User reviewer = admin("9830000017");

        for (int attempt = 1; attempt <= 3; attempt++) {
            submitPan(u, PAN).andExpect(status().isAccepted());
            reject(reviewer, caseOf(u)).andExpect(status().isOk());
        }

        mvc.perform(get(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.attemptsRemaining").value(0))
                .andExpect(jsonPath("$.retryAfter").exists());
        submitPan(u, PAN)
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists(HttpHeaders.RETRY_AFTER))
                .andExpect(jsonPath("$.error").value(ErrorCodes.RATE_LIMITED));
    }

    @Test
    void reviewRoutesAreBackOfficeOnly() throws Exception {
        User buyer = user("9830000018");
        submitPan(buyer, PAN).andExpect(status().isAccepted());

        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
        approve(buyer, caseOf(buyer), PAN).andExpect(status().isForbidden());
        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS)).andExpect(status().isUnauthorized());
    }

    @Test
    void reviewersCannotDecideTheirOwnIdentityCase() throws Exception {
        User self = admin("9830000049");
        User reviewer = admin("9830000050");
        submitPan(self, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(self);

        approve(self, id, PAN).andExpect(status().isForbidden());
        reject(self, id).andExpect(status().isForbidden());
        approve(reviewer, id, PAN).andExpect(status().isOk());
        revoke(self, id, "Self revocation must be blocked").andExpect(status().isForbidden());
    }

    @Test
    void aSecondAccountCannotBeApprovedOnTheSameCard_andIsWarnedAtSubmitToo() throws Exception {
        User first = user("9830000020");
        User second = user("9830000021");
        User third = user("9830000026");
        User reviewer = admin("9830000022");
        submitPan(first, PAN).andExpect(status().isAccepted());
        approve(reviewer, caseOf(first), PAN).andExpect(status().isOk());

        // The phone's OCR already names the taken card: refuse before a reviewer spends time on it.
        submitPan(second, PAN)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_ALREADY_REGISTERED));

        submitPan(third, OTHER_PAN).andExpect(status().isAccepted());
        approve(reviewer, caseOf(third), PAN)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_ALREADY_REGISTERED));
        assertThat(users.findById(third.getId()).orElseThrow().isVerified()).isFalse();
        assertThat(verifications.findById(caseOf(third)).orElseThrow().getStatus())
                .isEqualTo(VerificationStatuses.PENDING);
    }

    // ---------------- local-only "simulate a reviewer decision" ----------------
    @Test
    void theQueueFlagsASharedClaimOrPersonToTheReviewer() throws Exception {
        User first = user("9830000023");
        User second = user("9830000024");
        User reviewer = admin("9830000025");
        submitPan(first, PAN).andExpect(status().isAccepted());
        submitPan(second, PAN).andExpect(status().isAccepted());

        mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, caseOf(second)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings[*].userId").value(org.hamcrest.Matchers.hasItem(first.getId().toString())));
    }

    @Test
    void simulate_decidesTheCallersOwnPendingCaseInDev() throws Exception {
        User u = user("9830000030");
        submitPan(u, PAN).andExpect(status().isAccepted());

        mvc.perform(post(Routes.Verification.IDENTITY_SIMULATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED))
                .andExpect(jsonPath("$.decidedAt").exists());
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isTrue();

        mvc.perform(post(Routes.Verification.IDENTITY_SIMULATE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isConflict());
        mvc.perform(post(Routes.Verification.IDENTITY_SIMULATE)).andExpect(status().isUnauthorized());
    }

    @Test
    void simulate_canRejectToo() throws Exception {
        User u = user("9830000031");
        submitPan(u, PAN).andExpect(status().isAccepted());

        mvc.perform(post(Routes.Verification.IDENTITY_SIMULATE).param("outcome", "reject")
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REJECTED))
                .andExpect(jsonPath("$.attemptsRemaining").value(2));
    }

    @Test
    void decidedImagesArePurgedAfterTheRetentionWindow_butTheCaseRowRemains() throws Exception {
        User u = user("9830000032");
        User reviewer = admin("9830000033");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);
        approve(reviewer, id, PAN).andExpect(status().isOk());

        IdentityVerification row = verifications.findById(id).orElseThrow();
        row.setDecidedAt(Instant.now().minus(8, ChronoUnit.DAYS));
        row.setFilesPurgedAt(null);
        verifications.saveAndFlush(row);

        assertThat(files.findByVerificationId(id)).hasSize(2);
        assertThat(service.purgeExpiredFiles(7)).isEqualTo(1);
        assertThat(files.findByVerificationId(id)).isEmpty();
        assertThat(verifications.findById(id).orElseThrow().getFilesPurgedAt()).isNotNull();
    }

    @Test
    void stalePendingSweepRejectsPurgesAndDoesNotConsumeAnAttempt() throws Exception {
        User u = user("9830000051");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);
        IdentityVerification row = verifications.findById(id).orElseThrow();
        row.setSubmittedAt(Instant.now().minus(15, ChronoUnit.DAYS));
        verifications.saveAndFlush(row);

        assertThat(service.expireStalePending(Duration.ofDays(14))).isEqualTo(1);
        IdentityVerification expired = verifications.findById(id).orElseThrow();
        assertThat(expired.getStatus()).isEqualTo(VerificationStatuses.REJECTED);
        assertThat(expired.getRejectionReason()).isEqualTo(IdentityRejectRequest.NOT_REVIEWED);
        assertThat(expired.getAttemptCount()).isZero();
        assertThat(files.findByVerificationId(id)).isEmpty();

        mvc.perform(get(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.rejectionReason").value(IdentityRejectRequest.NOT_REVIEWED))
                .andExpect(jsonPath("$.attemptsRemaining").value(3));
        submitPan(u, PAN).andExpect(status().isAccepted());
        assertThat(verifications.findById(id).orElseThrow().getAttemptCount()).isEqualTo(1);
        assertThat(auditCount("identity.verification.expired", id)).isEqualTo(1);
    }

    @Test
    void stalePendingSweepSkipsFreshClaimsAndExpiresStaleClaims() throws Exception {
        User fresh = user("9830000052");
        User stale = user("9830000053");
        User reviewer = admin("9830000054");
        submitPan(fresh, PAN).andExpect(status().isAccepted());
        submitPan(stale, OTHER_PAN).andExpect(status().isAccepted());
        UUID freshId = caseOf(fresh);
        UUID staleId = caseOf(stale);
        Instant now = Instant.now();
        IdentityVerification freshClaim = verifications.findById(freshId).orElseThrow();
        freshClaim.setSubmittedAt(now.minus(15, ChronoUnit.DAYS));
        freshClaim.setClaimedBy(reviewer.getId());
        freshClaim.setClaimedAt(now.minus(29, ChronoUnit.MINUTES));
        IdentityVerification staleClaim = verifications.findById(staleId).orElseThrow();
        staleClaim.setSubmittedAt(now.minus(15, ChronoUnit.DAYS));
        staleClaim.setClaimedBy(reviewer.getId());
        staleClaim.setClaimedAt(now.minus(31, ChronoUnit.MINUTES));
        verifications.saveAndFlush(freshClaim);
        verifications.saveAndFlush(staleClaim);

        assertThat(service.expireStalePending(Duration.ofDays(14))).isEqualTo(1);

        assertThat(verifications.findById(freshId).orElseThrow().getStatus())
                .isEqualTo(VerificationStatuses.PENDING);
        assertThat(verifications.findById(staleId).orElseThrow().getStatus())
                .isEqualTo(VerificationStatuses.REJECTED);
    }

    @Test
    void erasureRemovesTheVerificationRowAndItsFiles() throws Exception {
        User u = user("9830000034");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);

        assertThat(files.findByVerificationId(id)).hasSize(2);
        assertThat(service.erase(u.getId())).isEqualTo(1);
        assertThat(verifications.findByUserId(u.getId())).isEmpty();
        assertThat(files.findByVerificationId(id)).isEmpty();
        assertThat(service.erase(u.getId())).isZero();
    }

    @Test
    void submit_rejectsUnknownLiveness() throws Exception {
        User u = user("9830000036");

        mvc.perform(submission(u, IdentityDocTypes.PAN, false).param("liveness", "maybe"))
                .andExpect(status().isBadRequest());
        assertThat(verifications.findByUserId(u.getId())).isEmpty();
    }

    @Test
    void withdrawPurgesFilesClearsBadgeAndReadsAsNone() throws Exception {
        User u = user("9830000052");
        User reviewer = admin("9830000053");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);
        approve(reviewer, id, PAN).andExpect(status().isOk());
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isTrue();

        mvc.perform(delete(Routes.Verification.IDENTITY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
        verifications.flush();
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isFalse();
        Map<String, Object> withdrawn = jdbc.queryForMap("""
                select status, attempt_count, identity_hash, claimed_name, files_purged_at
                from identity_verifications where id = ?
                """, id);
        assertThat(withdrawn.get("status")).isEqualTo(VerificationStatuses.WITHDRAWN);
        assertThat(withdrawn.get("attempt_count")).isEqualTo(1);
        assertThat(withdrawn.get("identity_hash")).isNull();
        assertThat(withdrawn.get("claimed_name")).isNull();
        assertThat(withdrawn.get("files_purged_at")).isNotNull();
        assertThat(files.findByVerificationId(id)).isEmpty();
        mvc.perform(get(Routes.Verification.IDENTITY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.NONE));

        mvc.perform(delete(Routes.Verification.IDENTITY)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
        Integer audits = jdbc.queryForObject(
                "select count(*) from audit_log where action = 'identity.verification.withdrawn' and actor = ?",
                Integer.class, u.getId().toString());
        assertThat(audits).isEqualTo(2);
    }

    @Test
    void withdrawalKeepsAttemptWindow() throws Exception {
        User u = user("9830000054");

        submitPan(u, PAN).andExpect(status().isAccepted());
        mvc.perform(delete(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
        submitPan(u, PAN).andExpect(status().isAccepted());
        mvc.perform(delete(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
        submitPan(u, PAN).andExpect(status().isAccepted());
        mvc.perform(delete(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());

        submitPan(u, PAN)
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists(HttpHeaders.RETRY_AFTER));
    }

    @Test
    void withdrawingARevokedCaseKeepsTheFraudHash() throws Exception {
        User first = user("9830000055");
        User second = user("9830000056");
        User reviewer = admin("9830000057");
        submitPan(first, PAN).andExpect(status().isAccepted());
        UUID firstId = caseOf(first);
        approve(reviewer, firstId, PAN).andExpect(status().isOk());
        revoke(reviewer, firstId, "The approved document was disputed").andExpect(status().isOk());

        mvc.perform(delete(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(first)))
                .andExpect(status().isNoContent());
        verifications.flush();
        assertThat(jdbc.queryForObject(
                "select identity_hash from identity_verifications where user_id = ?",
                String.class, first.getId())).isNotBlank();

        submitPan(second, OTHER_PAN).andExpect(status().isAccepted());
        approve(reviewer, caseOf(second), PAN)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_ALREADY_REGISTERED));
    }

    private ResultActions kycProfile(User reviewer, User target, String body) throws Exception {
        return mvc.perform(patch(Routes.Users.KYC_PROFILE, target.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    @Test
    void kycDeskCorrectsTheApplicantsNameAndEmail() throws Exception {
        User u = user("9830000090");
        User reviewer = person("9830000091", Roles.Wire.STAFF, "Kyc Desk");
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) VALUES (?, '[\"kyc\"]'::jsonb)",
                reviewer.getId());
        submitPan(u, PAN).andExpect(status().isAccepted());

        try {
            kycProfile(reviewer, u, "{\"name\":\"Asha R Patil\",\"email\":\"asha.kyc@example.test\"}")
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.name").value("Asha R Patil"))
                    .andExpect(jsonPath("$.email").value("asha.kyc@example.test"));
            mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, caseOf(u)))
                            .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.accountName").value("Asha R Patil"))
                    .andExpect(jsonPath("$.accountEmail").value("asha.kyc@example.test"));
            assertThat(jdbc.queryForObject(
                    "select count(*) from audit_log where action = 'user.kycProfileUpdate' and entity_id = ? and actor = ?",
                    Integer.class, u.getId().toString(), reviewer.getId().toString())).isEqualTo(1);
        } finally {
            jdbc.update("delete from audit_log where actor = ?", reviewer.getId().toString());
        }
    }

    @Test
    void kycProfileEditNeedsASubmittedCaseAndTheKycDesk() throws Exception {
        User applicant = user("9830000092");
        User bystander = user("9830000093");
        User support = person("9830000094", Roles.Wire.STAFF, "Support Desk");
        jdbc.update("INSERT INTO back_office_permissions (user_id, permissions) VALUES (?, '[\"support\"]'::jsonb)",
                support.getId());
        submitPan(applicant, PAN).andExpect(status().isAccepted());

        kycProfile(admin("9830000095"), bystander, "{\"name\":\"Someone Else\"}")
                .andExpect(status().isNotFound());
        kycProfile(support, applicant, "{\"name\":\"Someone Else\"}")
                .andExpect(status().isForbidden());
        kycProfile(admin("9830000096"), support, "{\"name\":\"Someone Else\"}")
                .andExpect(status().isForbidden());
        kycProfile(admin("9830000097"), applicant, "{\"name\":\"%s\"}".formatted("x".repeat(81)))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void aVerifiedCaseLocksTheNameEvenWhenTheBadgeWasRevokedByHand() throws Exception {
        User u = user("9830000098");
        User reviewer = admin("9830000099");
        submitPan(u, PAN).andExpect(status().isAccepted());
        approve(reviewer, caseOf(u), PAN).andExpect(status().isOk());
        jdbc.update("update users set verified = false where id = ?", u.getId());

        kycProfile(reviewer, u, "{\"name\":\"Someone Else\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.NAME_LOCKED_WHILE_VERIFIED));
    }
}
