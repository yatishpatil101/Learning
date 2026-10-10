package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItems;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.ResultActions;

@TestPropertySource(properties = "draazy.identity.qa-sample-rate=0.0")
class IdentityReviewSlimTest extends AbstractApiTest {

    private static final String PAN = "ABCDE1234F";
    private static final String TWIN_PAN = "QWERT5678Y";

    @Autowired
    UserRepository users;

    @Autowired
    IdentityVerificationRepository verifications;

    @Autowired
    LivenessCheck livenessCheck;

    @AfterEach
    void cleanAuditRows() {
        jdbc.update("delete from audit_log where action like 'identity.%'");
    }

    @Test
    void queueRowsCarryOnlyWhatALineShows() throws Exception {
        User reviewer = staff("9830018800", "Slim Admin");
        User subject = buyer("9830018801", "Slim Subject");
        submit(subject, PAN);

        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEWS).param("q", "Slim Subject")
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(caseOf(subject).toString()))
                .andExpect(jsonPath("$.content[0].userName").value("Slim Subject"))
                .andExpect(jsonPath("$.content[0].userMobile").value("9830018801"))
                .andExpect(jsonPath("$.content[0].status").value("pending"))
                .andExpect(jsonPath("$.content[0].docType").value("pan"))
                .andExpect(jsonPath("$.content[0].claimedByMe").value(false))
                .andExpect(jsonPath("$.content[0].userId").doesNotExist())
                .andExpect(jsonPath("$.content[0].accountEmail").doesNotExist())
                .andExpect(jsonPath("$.content[0].accountName").doesNotExist())
                .andExpect(jsonPath("$.content[0].holderName").doesNotExist())
                .andExpect(jsonPath("$.content[0].holderDob").doesNotExist())
                .andExpect(jsonPath("$.content[0].docLast4").doesNotExist())
                .andExpect(jsonPath("$.content[0].claimedHash").doesNotExist())
                .andExpect(jsonPath("$.content[0].claims").doesNotExist())
                .andExpect(jsonPath("$.content[0].liveness").doesNotExist())
                .andExpect(jsonPath("$.content[0].reviewerName").doesNotExist())
                .andExpect(jsonPath("$.content[0].images").doesNotExist())
                .andExpect(jsonPath("$.content[0].warnings").doesNotExist());
    }

    @Test
    void detailDropsUnreadHashAndLast4ButKeepsWhatTheModalShows() throws Exception {
        User reviewer = staff("9830018802", "Slim Admin");
        User subject = buyer("9830018803", "Detail Subject");
        submit(subject, PAN);
        UUID id = caseOf(subject);

        mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claimedHash").doesNotExist())
                .andExpect(jsonPath("$.docLast4").doesNotExist())
                .andExpect(jsonPath("$.claimedAt").doesNotExist())
                .andExpect(jsonPath("$.accountName").value("Detail Subject"))
                .andExpect(jsonPath("$.claims.number").value("234F"))
                .andExpect(jsonPath("$.images.front").isNotEmpty())
                .andExpect(jsonPath("$.images.selfie").isNotEmpty());
        assertThat(jdbc.queryForObject(
                "select count(*) from audit_log where action = 'identity.verification.viewed' and entity_id = ?",
                Long.class, id.toString())).isEqualTo(1L);
    }

    @Test
    void warningsNameEveryOtherAccountThatSharesTheDocument() throws Exception {
        User reviewer = staff("9830018804", "Slim Admin");
        User first = buyer("9830018805", "Twin One");
        User second = buyer("9830018806", "Twin Two");
        User third = buyer("9830018807", "Twin Three");
        submit(first, TWIN_PAN);
        submit(second, TWIN_PAN);
        submit(third, TWIN_PAN);

        mvc.perform(get(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID, caseOf(first)))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.warnings[?(@.kind == 'same_document_claimed')].userName",
                        hasItems("Twin Two", "Twin Three")));
    }

    @Test
    void claimAnswersWhoHoldsTheCaseAndReleaseIsNoContent() throws Exception {
        User reviewer = staff("9830018808", "Claim Slim Admin");
        User subject = buyer("9830018809", "Claim Slim Subject");
        submit(subject, PAN);
        UUID id = caseOf(subject);

        mvc.perform(post(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$.claimedByName").value("Claim Slim Admin"))
                .andExpect(jsonPath("$.claimedByMe").value(true))
                .andExpect(jsonPath("$.images").doesNotExist())
                .andExpect(jsonPath("$.accountEmail").doesNotExist());
        assertThat(verifications.findById(id).orElseThrow().getClaimedBy()).isEqualTo(reviewer.getId());

        mvc.perform(delete(reviewPath(Routes.Moderation.IDENTITY_REVIEW_BY_ID + "/claim", id))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)))
                .andExpect(status().isNoContent())
                .andExpect(content().string(""));
        assertThat(verifications.findById(id).orElseThrow().getClaimedBy()).isNull();
    }

    @Test
    void summaryCountsEveryTabInOneRead() throws Exception {
        User me = staff("9830018810", "Summary Admin");
        User other = staff("9830018811", "Summary Other");
        UUID mine = submit(buyer("9830018812", "Summary Mine"), PAN);
        UUID overdue = submit(buyer("9830018813", "Summary Overdue"), "ABCDE1235G");
        UUID rejected = submit(buyer("9830018814", "Summary Rejected"), "ABCDE1236H");
        jdbc.update("update identity_verifications set submitted_at = now() - interval '3 days' where id = ?", overdue);
        jdbc.update("update identity_verifications set claimed_by = ?, claimed_at = now() where id = ?",
                me.getId(), mine);
        jdbc.update("update identity_verifications set status = 'rejected', decided_at = now() where id = ?", rejected);
        long pendingBefore = jdbc.queryForObject(
                "select count(*) from identity_verifications where status = 'pending'", Long.class);
        long decidedBefore = jdbc.queryForObject(
                "select count(*) from identity_verifications where status in ('verified','rejected','revoked')",
                Long.class);
        long overdueBefore = jdbc.queryForObject(
                "select count(*) from identity_verifications where status = 'pending' and submitted_at < now() - interval '48 hours'",
                Long.class);

        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEW_SUMMARY).header(HttpHeaders.AUTHORIZATION, bearer(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pending").value(pendingBefore))
                .andExpect(jsonPath("$.overdue").value(overdueBefore))
                .andExpect(jsonPath("$.decided").value(decidedBefore))
                .andExpect(jsonPath("$.mine").value(1))
                .andExpect(jsonPath("$.qa").value(0));
        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEW_SUMMARY).header(HttpHeaders.AUTHORIZATION, bearer(other)))
                .andExpect(jsonPath("$.mine").value(0));
    }

    private User staff(String mobile, String name) {
        return user(mobile, Roles.Wire.ADMIN, name);
    }

    private User buyer(String mobile, String name) {
        return user(mobile, "buyer", name);
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private UUID submit(User subject, String number) throws Exception {
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        ResultActions result = mvc.perform(multipart(Routes.Verification.IDENTITY)
                .file(new MockMultipartFile("front", "front.png", "image/png", pngMagic))
                .file(new MockMultipartFile("selfie", "selfie.png", "image/png", pngMagic))
                .param("docType", IdentityDocTypes.PAN)
                .param("consent", "true")
                .param("claims", "{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}")
                .param("liveness", "passed")
                .param("challenge", livenessCheck.issue(subject.getId()).token())
                .header(HttpHeaders.AUTHORIZATION, bearer(subject)));
        result.andExpect(status().isAccepted());
        return caseOf(subject);
    }

    private UUID caseOf(User user) {
        return verifications.findByUserId(user.getId()).orElseThrow().getId();
    }

    private String reviewPath(String route, UUID id) {
        return route.replace("{id}", id.toString());
    }
}
