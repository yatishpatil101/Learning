package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
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
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

/**
 * Contract + behaviour for the document-and-selfie badge: multipart submission, 3-per-24h attempt
 * budget, reviewer queue, and one-document-one-account keyed on the reviewer's confirmed number.
 */
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
    IdentityVerificationService service;

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
        return mvc.perform(submission(u, IdentityDocTypes.PAN, false).param("claims", claims(number)));
    }

    private UUID caseOf(User u) {
        return verifications.findByUserId(u.getId()).orElseThrow().getId();
    }

    private String reviewPath(String route, UUID id) {
        return route.replace("{id}", id.toString());
    }

    private ResultActions approve(User reviewer, UUID id, String number) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_APPROVE, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}"));
    }

    private ResultActions reject(User reviewer, UUID id) throws Exception {
        return mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_REJECT, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"reason\":\"blurry\",\"note\":\"Retake in better light\"}"));
    }

    // ---------------- GET / POST /me/verification/identity ----------------

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

        mvc.perform(submission(u, IdentityDocTypes.AADHAAR, true).param("claims", claims(aadhaar)))
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
        // A licence is read from the front, so a back is refused the same way a PAN's is.
        mvc.perform(submission(u, IdentityDocTypes.DRIVING_LICENCE, true))
                .andExpect(status().isUnprocessableEntity());
        assertThat(verifications.findByUserId(u.getId())).isEmpty();
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
        mvc.perform(submission(u, "passport", false))
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

    // ---------------- the reviewer ----------------

    @Test
    void approve_grantsTheBadge_storesOnlyLast4_andHashesTheReviewersNumber() throws Exception {
        User u = user("9830000010");
        User reviewer = admin("9830000011");
        submitPan(u, PAN).andExpect(status().isAccepted());
        UUID id = caseOf(u);

        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
            .andExpect(jsonPath("$.content[?(@.id == '" + id + "')].claims.number").value(PAN.substring(6)));

        mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, id))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.images.front").exists())
            .andExpect(jsonPath("$.images.selfie").exists());

        approve(reviewer, id, PAN)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED))
                .andExpect(jsonPath("$.docLast4").value(PAN.substring(6)))
                .andExpect(jsonPath("$.holderName").value("Asha Patil"));

        IdentityVerification row = verifications.findById(id).orElseThrow();
        assertThat(row.getIdentityHash()).isNotBlank().doesNotContain(PAN);
        assertThat(row.getReviewerId()).isEqualTo(reviewer.getId());
        assertThat(users.findById(u.getId()).orElseThrow().isVerified()).isTrue();

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
    void reject_opensARetry_withTheReasonAndRemainingAttemptsVisibleToTheUser() throws Exception {
        User u = user("9830000014");
        User reviewer = admin("9830000015");
        submitPan(u, PAN).andExpect(status().isAccepted());

        reject(reviewer, caseOf(u))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REJECTED))
                .andExpect(jsonPath("$.rejectionReason").value("blurry"));

        mvc.perform(get(Routes.Verification.IDENTITY).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(jsonPath("$.status").value(VerificationStatuses.REJECTED))
                .andExpect(jsonPath("$.rejectionNote").value("Retake in better light"))
                .andExpect(jsonPath("$.attemptsRemaining").value(2));

        // The retake replaces the rejected case in place: one row per account, old photos gone.
        UUID before = caseOf(u);
        submitPan(u, PAN).andExpect(status().isAccepted());
        assertThat(caseOf(u)).isEqualTo(before);
        assertThat(verifications.findById(before).orElseThrow().getAttemptCount()).isEqualTo(2);
        assertThat(files.findByVerificationId(before)).hasSize(2);
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

    // ---------------- one document = one account ----------------

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

        // OCR misread (or was tampered with), so the claim slipped through — the reviewer's number
        // is what the guarantee actually hangs on.
        submitPan(third, OTHER_PAN).andExpect(status().isAccepted());
        approve(reviewer, caseOf(third), PAN)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_ALREADY_REGISTERED));
        assertThat(users.findById(third.getId()).orElseThrow().isVerified()).isFalse();
        assertThat(verifications.findById(caseOf(third)).orElseThrow().getStatus())
                .isEqualTo(VerificationStatuses.PENDING);
    }

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

    // ---------------- local-only "simulate a reviewer decision" ----------------

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

        // Nothing left to decide: a replay is a 409, not a second grant.
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
}
