package com.draazy.api.identity.verification;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.DecisionMessenger;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@DisplayName("Identity decisions and the paid WhatsApp notice")
class IdentityDecisionWhatsappTest {

    @MockitoBean
    DecisionMessenger messenger;

    @Autowired
    UserRepository users;

    @Autowired
    IdentityVerificationRepository verifications;

    @Autowired
    IdentityReviewService review;

    @Autowired
    IdentityVerificationService identity;

    private final List<UUID> created = new ArrayList<>();

    // These decisions must commit for the after-commit WhatsApp to fire, so the cases are erased by hand;
    // a left-over verified case would otherwise sit in every later reviewer's QA tab.
    @AfterEach
    void eraseCases() {
        created.forEach(identity::erase);
    }

    private User user() {
        User user = new User(String.format("98%08d", ThreadLocalRandom.current().nextInt(100_000_000)),
                Roles.Wire.BUYER);
        user.setMobileVerified(true);
        User saved = users.saveAndFlush(user);
        created.add(saved.getId());
        return saved;
    }

    private IdentityVerification pending(User applicant) {
        return verifications.saveAndFlush(new IdentityVerification(applicant.getId(), IdentityDocTypes.PAN,
                Instant.now()));
    }

    private AuthPrincipal reviewer() {
        return new AuthPrincipal(user().getId(), "admin", "ops", true, true);
    }

    private static String randomPan() {
        return String.format("ABCPE%04dF", ThreadLocalRandom.current().nextInt(10_000));
    }

    @Test
    @DisplayName("approving identity sends no WhatsApp; the in-app notice covers it")
    void approvalSendsNoWhatsapp() {
        User applicant = user();
        IdentityVerification v = pending(applicant);

        review.approve(reviewer(), v.getId(), new IdentityApproveRequest(randomPan(), "Asha Patil",
                LocalDate.of(1991, 4, 12), null));

        verify(messenger, never()).sendIdentityDecision(anyString(), anyString());
    }

    @Test
    @DisplayName("an automatic reject sends no WhatsApp")
    void automaticRejectSendsNoWhatsapp() {
        IdentityVerification v = pending(user());

        review.rejectSystem(v.getId(), new IdentityRejectRequest("blurry", null));

        verify(messenger, never()).sendIdentityDecision(anyString(), anyString());
    }

    @Test
    @DisplayName("a reviewer's reject still sends the WhatsApp notice")
    void reviewerRejectSendsWhatsapp() {
        User applicant = user();
        IdentityVerification v = pending(applicant);

        review.reject(reviewer(), v.getId(), new IdentityRejectRequest("blurry", null));

        verify(messenger).sendIdentityDecision(eq(applicant.getMobile()), anyString());
    }

    @Test
    @DisplayName("revoking a verified identity still sends the WhatsApp notice")
    void revokeSendsWhatsapp() {
        User applicant = user();
        IdentityVerification v = pending(applicant);
        v.setStatus(VerificationStatuses.VERIFIED);
        v.setDecidedAt(Instant.now());
        verifications.saveAndFlush(v);

        review.revoke(reviewer(), v.getId(), new IdentityRevokeRequest("Document was forged"));

        verify(messenger).sendIdentityDecision(eq(applicant.getMobile()), anyString());
    }
}
