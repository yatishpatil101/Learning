package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import com.jayway.jsonpath.JsonPath;
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
class IdentityLivenessChallengeTest extends AbstractApiTest {

    private static final String PAN = "ABCDE1234F";

    @Autowired
    UserRepository users;

    @Autowired
    IdentityVerificationRepository verifications;

    @Autowired
    LivenessCheck liveness;

    @AfterEach
    void cleanAuditRows() {
        jdbc.update("delete from audit_log where action in ("
                + "'identity.verification.approved', 'user.name.set_from_identity')");
    }

    @Test
    void challengeEndpointIssuesASignedPoseThatSubmitStores() throws Exception {
        User subject = user("9830012001", "buyer");
        String body = mvc.perform(post(Routes.Verification.IDENTITY_CHALLENGE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(subject)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isString())
                .andExpect(jsonPath("$.expiresAt").exists())
                .andReturn().getResponse().getContentAsString();
        String token = JsonPath.read(body, "$.token");
        String pose = JsonPath.read(body, "$.pose");

        mvc.perform(submission(subject, PAN).param("challenge", token))
                .andExpect(status().isAccepted());

        assertThat(caseOf(subject).getLivenessChallenge()).isEqualTo(pose);
    }

    @Test
    void anotherUsersOrTamperedChallengeIsRefusedAtSubmit() throws Exception {
        User subject = user("9830012002", "buyer");
        User other = user("9830012003", "buyer");

        mvc.perform(submission(subject, PAN).param("challenge", liveness.issue(other.getId()).token()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_CHALLENGE_INVALID));
        assertThat(verifications.findByUserId(subject.getId())).isEmpty();
    }

    @Test
    void approvalNeedsThePoseConfirmedWhenAChallengeWasSigned() throws Exception {
        User subject = user("9830012004", "buyer");
        User reviewer = user("9830012005", Roles.Wire.ADMIN);
        mvc.perform(submission(subject, PAN).param("challenge", liveness.issue(subject.getId()).token()))
                .andExpect(status().isAccepted());
        UUID id = caseOf(subject).getId();

        approve(reviewer, id, PAN, "")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_POSE_UNCONFIRMED));
        approve(reviewer, id, PAN, ",\"poseConfirmed\":true")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.livenessSource").value("challenge"))
                .andExpect(jsonPath("$.numberOverridden").value(false));
        assertThat(caseOf(subject).getQaSampledAt()).isNull();
    }

    @Test
    void numberMismatchIsASoftStopAndTheOverrideAlwaysGoesToQa() throws Exception {
        User subject = user("9830012006", "buyer");
        User reviewer = user("9830012007", Roles.Wire.ADMIN);
        mvc.perform(submission(subject, PAN).param("challenge", liveness.issue(subject.getId()).token()))
                .andExpect(status().isAccepted());
        UUID id = caseOf(subject).getId();

        approve(reviewer, id, "ABCDE1239K", ",\"poseConfirmed\":true")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_NUMBER_MISMATCH));
        approve(reviewer, id, "ABCDE1239K", ",\"poseConfirmed\":true,\"numberOverride\":true")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value(VerificationStatuses.VERIFIED))
                .andExpect(jsonPath("$.numberOverridden").value(true));

        IdentityVerification v = caseOf(subject);
        assertThat(v.isNumberOverridden()).isTrue();
        assertThat(v.getQaSampledAt()).as("an overridden number always gets a second look").isNotNull();
        assertThat(jdbc.queryForObject("""
                select metadata ->> 'numberOverridden' from audit_log
                 where action = 'identity.verification.approved' and entity_id = ?
                """, String.class, id.toString())).isEqualTo("true");
    }

    @Test
    void submissionWithoutAChallengeIsAlwaysSampledForQa() throws Exception {
        User subject = user("9830012008", "buyer");
        User reviewer = user("9830012009", Roles.Wire.ADMIN);
        mvc.perform(submission(subject, PAN)).andExpect(status().isAccepted());

        approve(reviewer, caseOf(subject).getId(), PAN, "")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.livenessSource").value("client"));
        assertThat(caseOf(subject).getQaSampledAt()).isNotNull();
    }

    private User user(String mobile, String role) {
        User u = new User(mobile, role);
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private IdentityVerification caseOf(User user) {
        return verifications.findByUserId(user.getId()).orElseThrow();
    }

    private static MockMultipartFile png(String field) {
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        return new MockMultipartFile(field, field + ".png", "image/png", pngMagic);
    }

    private MockMultipartHttpServletRequestBuilder submission(User user, String number) {
        return multipart(Routes.Verification.IDENTITY)
                .file(png("front"))
                .file(png("selfie"))
                .param("docType", IdentityDocTypes.PAN)
                .param("consent", "true")
                .param("claims", "{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}")
                .param("liveness", "passed")
                .header(HttpHeaders.AUTHORIZATION, bearer(user));
    }

    private ResultActions approve(User reviewer, UUID id, String number, String extra) throws Exception {
        return mvc.perform(post(Routes.Moderation.IDENTITY_REVIEW_APPROVE.replace("{id}", id.toString()))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"" + extra + "}"));
    }
}
