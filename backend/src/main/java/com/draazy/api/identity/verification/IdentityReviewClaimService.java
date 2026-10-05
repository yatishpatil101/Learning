package com.draazy.api.identity.verification;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class IdentityReviewClaimService {

    static final Duration CLAIM_TTL = Duration.ofMinutes(30);
    private static final int MAX_ACTIVE_CLAIMS = 3;

    private final IdentityVerificationRepository verifications;
    private final UserRepository users;
    private final IdentityReviewService reviews;
    private final IdentityReviewReadService read;
    private final Clock clock;
    private final EntityManager entityManager;
    private final AuditService audit;

    public IdentityReviewClaimService(IdentityVerificationRepository verifications, UserRepository users,
            IdentityReviewService reviews, IdentityReviewReadService read, Clock clock, EntityManager entityManager,
            AuditService audit) {
        this.verifications = verifications;
        this.users = users;
        this.reviews = reviews;
        this.read = read;
        this.clock = clock;
        this.entityManager = entityManager;
        this.audit = audit;
    }

    @Transactional
    public IdentityReviewResponse claim(AuthPrincipal reviewer, UUID id) {
        lockReviewerClaims(reviewer);
        IdentityVerification v = reviews.requireForUpdate(id);
        IdentityReviewService.requireOtherPerson(reviewer, v, "You cannot claim your own identity verification");
        IdentityReviewService.requirePending(v);
        Instant now = Instant.now(clock);
        if (isFreshClaim(v, now) && !reviewer.userId().equals(v.getClaimedBy())) {
            throwClaimed(v);
        }
        if (isFreshClaim(v, now) && reviewer.userId().equals(v.getClaimedBy())) {
            return read.currentReview(reviewer, v);
        }
        requireClaimCapacity(reviewer, now);
        v.setClaimedBy(reviewer.userId());
        v.setClaimedAt(now);
        recordAuditAfterCommit(reviewer, "identity.review.claimed", v,
                "userId", v.getUserId().toString());
        return read.currentReview(reviewer, v);
    }

    @Transactional
    public IdentityReviewResponse releaseClaim(AuthPrincipal reviewer, UUID id, boolean force) {
        IdentityVerification v = reviews.requireForUpdate(id);
        if (force) {
            return forceRelease(reviewer, v);
        }
        IdentityReviewService.requireOtherPerson(reviewer, v, "You cannot release your own identity verification claim");
        IdentityReviewService.requirePending(v);
        Instant now = Instant.now(clock);
        if (v.getClaimedBy() == null) {
            throw new ConflictException("This case is not claimed");
        }
        if (isFreshClaim(v, now) && !reviewer.userId().equals(v.getClaimedBy())) {
            throwClaimed(v);
        }
        v.setClaimedBy(null);
        v.setClaimedAt(null);
        reviews.recordAudit(reviewer, "identity.review.released", v, "userId", v.getUserId().toString());
        return read.currentReview(reviewer, v);
    }

    private IdentityReviewResponse forceRelease(AuthPrincipal reviewer, IdentityVerification v) {
        if (!Roles.Wire.ADMIN.equals(reviewer.role())) {
            throw new ForbiddenException("Only admins can force-release identity review claims");
        }
        IdentityReviewService.requirePending(v);
        if (v.getClaimedBy() == null) {
            throw new ConflictException("This case is not claimed");
        }
        String heldBy = v.getClaimedBy().toString();
        v.setClaimedBy(null);
        v.setClaimedAt(null);
        reviews.recordAudit(reviewer, "identity.claim.force_released", v,
                "userId", v.getUserId().toString(), "heldBy", heldBy);
        return read.currentReview(reviewer, v);
    }

    private void recordAuditAfterCommit(AuthPrincipal reviewer, String action, IdentityVerification v,
            Object... context) {
        Runnable callback = () -> audit.record(reviewer, action, "identity_verification", v.getId().toString(), context);
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            callback.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                callback.run();
            }
        });
    }

    private void lockReviewerClaims(AuthPrincipal reviewer) {
        entityManager.createNativeQuery("select pg_advisory_xact_lock(hashtextextended(cast(:reviewerId as text), 1))")
                .setParameter("reviewerId", reviewer.userId().toString())
                .getSingleResult();
    }

    private void requireClaimCapacity(AuthPrincipal reviewer, Instant now) {
        long active = verifications.countByClaimedByAndStatusAndClaimedAtAfter(
                reviewer.userId(), VerificationStatuses.PENDING, now.minus(CLAIM_TTL));
        if (active >= MAX_ACTIVE_CLAIMS) {
            throw new ConflictException(ErrorCodes.IDENTITY_CASE_CLAIM_LIMIT,
                    "Reviewers may hold at most 3 active identity claims");
        }
    }

    private boolean isFreshClaim(IdentityVerification v, Instant now) {
        return v.getClaimedBy() != null
                && v.getClaimedAt() != null
                && v.getClaimedAt().isAfter(now.minus(CLAIM_TTL));
    }

    private void throwClaimed(IdentityVerification v) {
        String name = users.findById(v.getClaimedBy()).map(User::getName).orElse("another reviewer");
        throw new ConflictException(ErrorCodes.IDENTITY_CASE_CLAIMED,
                "This case is claimed by " + name);
    }
}
