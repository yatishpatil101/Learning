package com.draazy.api.identity.verification;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@TestPropertySource(properties = "draazy.identity.qa-sample-rate=0.0")
class IdentityReviewQueueTest extends AbstractApiTest {

    private static final String NAME = "Queuefilter Zeta";

    @Autowired
    UserRepository users;

    @Autowired
    IdentityVerificationRepository verifications;

    @Autowired
    LivenessCheck livenessCheck;

    private final List<UUID> cases = new ArrayList<>();

    @AfterEach
    void cleanAuditRows() {
        cases.forEach(id -> jdbc.update("delete from audit_log where entity_id = ?", id.toString()));
    }

    @Test
    void pagesAreServerSideAndTotalCountsEveryMatch() throws Exception {
        User reviewer = user("9830017700", Roles.Wire.ADMIN, "Queue Admin");
        for (int i = 1; i <= 3; i++) {
            submit(user("983001771" + i, "buyer", NAME + " " + i), IdentityDocTypes.PAN);
        }

        list(reviewer, "q", NAME, "size", "2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].userName").value(NAME + " 1"));
        list(reviewer, "q", NAME, "size", "2", "sort", "newest")
                .andExpect(jsonPath("$.content[0].userName").value(NAME + " 3"));
        list(reviewer, "q", NAME, "size", "2", "page", "1")
                .andExpect(jsonPath("$.content.length()").value(1));
    }

    @Test
    void searchMatchesMobileDigitsAndDocTypeNarrows() throws Exception {
        User reviewer = user("9830017701", Roles.Wire.ADMIN, "Queue Admin");
        submit(user("9830017721", "buyer", NAME + " Pan"), IdentityDocTypes.PAN);
        submit(user("9830017722", "buyer", NAME + " Passport"), IdentityDocTypes.PASSPORT);

        list(reviewer, "q", "98300 17722")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].userName").value(NAME + " Passport"));
        list(reviewer, "q", NAME, "docType", IdentityDocTypes.PAN)
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].docType").value(IdentityDocTypes.PAN));
        list(reviewer, "q", "%")
                .andExpect(status().isOk());
    }

    @Test
    void claimFilterSplitsMineUnclaimedAndOthers() throws Exception {
        User me = user("9830017702", Roles.Wire.ADMIN, "Queue Admin A");
        User other = user("9830017703", Roles.Wire.ADMIN, "Queue Admin B");
        UUID held = submit(user("9830017731", "buyer", NAME + " Held"), IdentityDocTypes.PAN);
        submit(user("9830017732", "buyer", NAME + " Free"), IdentityDocTypes.PAN);
        claim(me, held).andExpect(status().isOk());

        list(me, "q", NAME, "claim", "mine")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(held.toString()));
        list(me, "q", NAME, "claim", "unclaimed")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].userName").value(NAME + " Free"));
        list(other, "q", NAME, "claim", "others")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].claimedByName").value("Queue Admin A"));
        list(other, "q", NAME, "claim", "mine")
                .andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEW_SUMMARY).header(HttpHeaders.AUTHORIZATION, bearer(me)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mine").value(1))
                .andExpect(jsonPath("$.pending").isNumber())
                .andExpect(jsonPath("$.overdue").isNumber())
                .andExpect(jsonPath("$.qa").isNumber())
                .andExpect(jsonPath("$.decided").isNumber());
    }

    @Test
    void overdueKeepsOnlyCasesPastFortyEightHours() throws Exception {
        User reviewer = user("9830017704", Roles.Wire.ADMIN, "Queue Admin");
        UUID old = submit(user("9830017741", "buyer", NAME + " Old"), IdentityDocTypes.PAN);
        submit(user("9830017742", "buyer", NAME + " New"), IdentityDocTypes.PAN);
        jdbc.update("update identity_verifications set submitted_at = now() - interval '3 days' where id = ?", old);

        list(reviewer, "q", NAME, "overdue", "true")
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value(old.toString()));
    }

    @Test
    void decidedMergesOutcomesAndOutcomeNarrows() throws Exception {
        User reviewer = user("9830017705", Roles.Wire.ADMIN, "Queue Admin");
        UUID rejected = submit(user("9830017751", "buyer", NAME + " Rejected"), IdentityDocTypes.PAN);
        submit(user("9830017752", "buyer", NAME + " Waiting"), IdentityDocTypes.PAN);
        mvc.perform(post(Routes.Moderation.IDENTITY_REVIEW_REJECT.replace("{id}", rejected.toString()))
                        .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"blurry\",\"note\":\"The image is too blurry to verify\"}"))
                .andExpect(status().isOk());

        list(reviewer, "status", "decided", "q", NAME)
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].status").value(VerificationStatuses.REJECTED));
        list(reviewer, "status", "decided", "q", NAME, "outcome", "verified")
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void unknownFilterValuesAreBadRequests() throws Exception {
        User reviewer = user("9830017706", Roles.Wire.ADMIN, "Queue Admin");
        list(reviewer, "claim", "everyone").andExpect(status().isBadRequest());
        list(reviewer, "sort", "submittedAt").andExpect(status().isBadRequest());
        list(reviewer, "docType", "ration_card").andExpect(status().isBadRequest());
        list(reviewer, "status", "decided", "outcome", "pending").andExpect(status().isBadRequest());
    }

    @Test
    void summaryNeedsIdentityRead() throws Exception {
        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEW_SUMMARY)).andExpect(status().isUnauthorized());
        User buyer = user("9830017707", "buyer", "Not Staff");
        mvc.perform(get(Routes.Moderation.IDENTITY_REVIEW_SUMMARY).header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());
    }

    private User user(String mobile, String role, String name) {
        User u = new User(mobile, role);
        u.setName(name);
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private ResultActions list(User reviewer, String... params) throws Exception {
        MockHttpServletRequestBuilder request = get(Routes.Moderation.IDENTITY_REVIEWS)
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer));
        for (int i = 0; i < params.length; i += 2) {
            request.param(params[i], params[i + 1]);
        }
        return mvc.perform(request);
    }

    private ResultActions claim(User reviewer, UUID id) throws Exception {
        return mvc.perform(post(Routes.Moderation.IDENTITY_REVIEW_BY_ID.replace("{id}", id.toString()) + "/claim")
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer)));
    }

    private UUID submit(User subject, String docType) throws Exception {
        String number = IdentityDocTypes.PASSPORT.equals(docType) ? "Z" + subject.getMobile().substring(3) : "ABCDE" + subject.getMobile().substring(6) + "F";
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        mvc.perform(multipart(Routes.Verification.IDENTITY)
                        .file(new MockMultipartFile("front", "front.png", "image/png", pngMagic))
                        .file(new MockMultipartFile("selfie", "selfie.png", "image/png", pngMagic))
                        .param("docType", docType)
                        .param("consent", "true")
                        .param("claims", "{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}")
                        .param("liveness", "passed")
                        .param("challenge", livenessCheck.issue(subject.getId()).token())
                        .header(HttpHeaders.AUTHORIZATION, bearer(subject)))
                .andExpect(status().isAccepted());
        UUID id = verifications.findByUserId(subject.getId()).orElseThrow().getId();
        cases.add(id);
        return id;
    }
}
