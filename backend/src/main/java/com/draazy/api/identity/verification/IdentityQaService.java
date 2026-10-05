package com.draazy.api.identity.verification;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.security.AuthPrincipal;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityQaService {

    private static final String QA_CONFIRMED = "confirmed";
    private static final String QA_REVOKED = "revoked";

    private final IdentityVerificationRepository verifications;
    private final IdentityReviewService reviews;
    private final IdentityReviewReadService read;
    private final Clock clock;

    public IdentityQaService(IdentityVerificationRepository verifications, IdentityReviewService reviews,
            IdentityReviewReadService read, Clock clock) {
        this.verifications = verifications;
        this.reviews = reviews;
        this.read = read;
        this.clock = clock;
    }

    @Transactional
    public IdentityReviewResponse qa(AuthPrincipal reviewer, UUID id, IdentityQaRequest body) {
        IdentityVerification v = reviews.requireForUpdate(id);
        requireQaReviewAllowed(reviewer, v);
        String outcome = body.outcome().trim();
        Instant now = Instant.now(clock);
        if (QA_CONFIRMED.equals(outcome)) {
            v.setQaReviewedBy(reviewer.userId());
            v.setQaReviewedAt(now);
            v.setQaOutcome(QA_CONFIRMED);
            verifications.saveAndFlush(v);
            reviews.recordAudit(reviewer, "identity.review.qa_confirmed", v, "userId", v.getUserId().toString());
            return read.currentReview(reviewer, v);
        }
        if (QA_REVOKED.equals(outcome)) {
            String reason = body.reason() == null ? "" : body.reason().trim();
            IdentityReviewService.requireReasonLength(reason);
            v.setQaReviewedBy(reviewer.userId());
            v.setQaReviewedAt(now);
            v.setQaOutcome(QA_REVOKED);
            reviews.revokeVerified(reviewer, v, reason, now);
            reviews.recordAudit(reviewer, "identity.review.qa_revoked", v,
                    "reason", reason, "userId", v.getUserId().toString());
            return read.currentReview(reviewer, v);
        }
        throw new BadRequestException("outcome must be confirmed or revoked");
    }

    private static void requireQaReviewAllowed(AuthPrincipal reviewer, IdentityVerification v) {
        IdentityReviewService.requireOtherPerson(reviewer, v, "You cannot QA your own identity verification");
        if (!VerificationStatuses.VERIFIED.equals(v.getStatus())
                || v.getQaSampledAt() == null
                || v.getQaReviewedAt() != null) {
            throw new ConflictException("This case is not open for QA review");
        }
        if (v.getReviewerId() != null && reviewer.userId().equals(v.getReviewerId())) {
            throw new ForbiddenException("The approver cannot QA their own identity decision");
        }
    }
}
