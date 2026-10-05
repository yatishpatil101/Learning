package com.draazy.api.identity.verification;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.IdentityAlreadyRegisteredException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.persistence.ConstraintViolations;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.trust.OwnerBadgeSink;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.DecisionMessenger;
import com.draazy.api.security.AuthPrincipal;
import java.text.Normalizer;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class IdentityReviewService {

    private static final Logger log = LoggerFactory.getLogger(IdentityReviewService.class);

    private static final String IDENTITY_HASH_CONSTRAINT = "identity_verifications_identity_hash_key";
    private static final Duration CLAIM_TTL = Duration.ofMinutes(30);
    private static final String VERIFIED_BADGE_LINK = "/dashboard";
    private static final String SYSTEM_ACTOR_ID = "system";
    private static final String SYSTEM_ACTOR_ROLE = "admin";
    private static final int MAX_NAME_CHARS = 80;

    private final IdentityVerificationRepository verifications;
    private final UserRepository users;
    private final IdentityHasher hasher;
    private final OwnerBadgeSink ownerBadge;
    private final Notifier notifier;
    private final DecisionMessenger decisionMessenger;
    private final AuditService audit;
    private final Clock clock;
    private final IdentityReviewReadService read;
    private final double qaSampleRate;

    public IdentityReviewService(IdentityVerificationRepository verifications, UserRepository users,
            IdentityHasher hasher, OwnerBadgeSink ownerBadge, Notifier notifier,
            DecisionMessenger decisionMessenger, AuditService audit, Clock clock, IdentityReviewReadService read,
            @Value("${draazy.identity.qa-sample-rate:0.25}") double qaSampleRate) {
        this.verifications = verifications;
        this.users = users;
        this.hasher = hasher;
        this.ownerBadge = ownerBadge;
        this.notifier = notifier;
        this.decisionMessenger = decisionMessenger;
        this.audit = audit;
        this.clock = clock;
        this.read = read;
        this.qaSampleRate = qaSampleRate;
    }

    @Transactional(readOnly = true)
    public IdentityReviewResponse detail(AuthPrincipal actor, UUID id) {
        return read.detail(actor, require(id));
    }

    @Transactional
    public IdentityReviewResponse approve(AuthPrincipal reviewer, UUID id, IdentityApproveRequest body) {
        return approve(reviewer, id, body, false);
    }

    @Transactional
    public IdentityReviewResponse approveSystem(UUID id, IdentityApproveRequest body) {
        return approve(null, id, body, true);
    }

    private IdentityReviewResponse approve(AuthPrincipal reviewer, UUID id, IdentityApproveRequest body,
            boolean systemActor) {
        IdentityVerification v = requireForUpdate(id);
        requireOtherPerson(reviewer, v, "You cannot approve your own identity verification");
        requirePending(v);
        requireFreshClaimHolderOrUnclaimed(reviewer, v);
        String canonical = IdentityNumbers.canonical(v.getDocType(), body.number())
                .orElseThrow(() -> new ValidationException(
                        "number is not a valid " + v.getDocType() + " number"));
        ConfirmedDob dob = confirmedDob(body);
        String hash = hasher.docHash(v.getDocType(), canonical);
        Optional<IdentityVerification> holder = verifications.findByIdentityHash(hash);
        if (holder.isPresent() && !holder.get().getId().equals(v.getId())) {
            throw new IdentityAlreadyRegisteredException(
                    "This document is already verified on another account");
        }
        if (!systemActor && v.getLivenessChallenge() != null && !Boolean.TRUE.equals(body.poseConfirmed())) {
            throw new BadRequestException(ErrorCodes.IDENTITY_POSE_UNCONFIRMED,
                    "Confirm the selfie shows the requested pose before approving");
        }
        boolean numberOverridden = !systemActor && v.getClaimedHash() != null
                && !v.getClaimedHash().equals(hash);
        if (numberOverridden && !Boolean.TRUE.equals(body.numberOverride())) {
            throw new ConflictException(ErrorCodes.IDENTITY_NUMBER_MISMATCH,
                    "The number you entered doesn't match the applicant's entry. Re-check the image.");
        }
        Instant now = Instant.now(clock);
        String legalName = normaliseName(body.name());
        v.setIdentityHash(hash);
        v.setDocLast4(IdentityNumbers.last4(canonical));
        v.setHolderName(legalName);
        v.setHolderDob(dob.value());
        v.setHolderDobYearOnly(dob.yearOnly());
        v.setPersonKey(hasher.personKey(v.getHolderName(), v.getHolderDob()));
        v.setNumberOverridden(numberOverridden);
        v.setStatus(VerificationStatuses.VERIFIED);
        v.setReviewerId(systemActor ? null : reviewer.userId());
        v.setDecidedAt(now);
        v.setClaimedBy(null);
        v.setClaimedAt(null);
        if (shouldSampleQa(v)) {
            v.setQaSampledAt(now);
        }
        flushIdentityHash();

        User user = users.findById(v.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));
        String oldName = user.getName();
        user.setName(legalName);
        user.setVerified(true);
        users.saveAndFlush(user);
        verifications.saveAndFlush(v);
        int listings = ownerBadge.markOwnerVerified(user.getId());
        log.info("identity approved user={} reviewer={} listingsStamped={}", user.getId(),
                reviewer == null ? null : reviewer.userId(), listings);

        UUID userId = user.getId();
        String mobile = user.getMobile();
        notifier.notify(userId, "identity.approved", "You're verified",
                "Your identity has been confirmed. Your profile name now matches your ID: " + legalName,
                VERIFIED_BADGE_LINK);
        afterCommit(() -> decisionMessenger.sendIdentityDecision(mobile,
                "Your Draazy identity verification is approved. Your profile now shows the verified badge."));
        recordUserNameAudit(reviewer, userId, oldName, legalName, v.getId());
        recordAudit(reviewer, "identity.verification.approved", v,
                "docType", v.getDocType(), "userId", v.getUserId().toString(),
                "numberOverridden", String.valueOf(numberOverridden),
                "poseChallenge", String.valueOf(v.getLivenessChallenge()));
        return read.currentReview(reviewer, v);
    }

    @Transactional
    public IdentityReviewResponse reject(AuthPrincipal reviewer, UUID id, IdentityRejectRequest body) {
        return reject(reviewer, id, body, false);
    }

    @Transactional
    public IdentityReviewResponse rejectSystem(UUID id, IdentityRejectRequest body) {
        return reject(null, id, body, true);
    }

    private IdentityReviewResponse reject(AuthPrincipal reviewer, UUID id, IdentityRejectRequest body,
            boolean systemActor) {
        validateStaffReject(body);
        IdentityVerification v = requireForUpdate(id);
        requireOtherPerson(reviewer, v, "You cannot reject your own identity verification");
        requirePending(v);
        requireFreshClaimHolderOrUnclaimed(reviewer, v);
        v.setStatus(VerificationStatuses.REJECTED);
        v.setRejectionReason(body.reason());
        v.setRejectionNote(body.note() == null || body.note().isBlank() ? null : body.note().trim());
        v.setReviewerId(systemActor ? null : reviewer.userId());
        v.setDecidedAt(Instant.now(clock));
        v.setClaimedBy(null);
        v.setClaimedAt(null);

        User user = users.findById(v.getUserId()).orElse(null);
        UUID userId = v.getUserId();
        String mobile = user == null ? null : user.getMobile();
        notifier.notify(userId, "identity.rejected", "Verification needs another try",
                "We couldn't verify your ID this time. Open the verification page to see why and retake.",
                "/verify-identity");
        if (mobile != null) {
            afterCommit(() -> decisionMessenger.sendIdentityDecision(mobile,
                    "Your Draazy identity verification could not be completed. Open the app to see the reason and retake your photos."));
        }
        recordAudit(reviewer, "identity.verification.rejected", v,
                "reason", body.reason(), "userId", v.getUserId().toString());
        return read.currentReview(reviewer, v);
    }

    @Transactional
    public IdentityReviewResponse revoke(AuthPrincipal reviewer, UUID id, IdentityRevokeRequest body) {
        IdentityVerification v = requireForUpdate(id);
        requireOtherPerson(reviewer, v, "You cannot revoke your own identity verification");
        if (!VerificationStatuses.VERIFIED.equals(v.getStatus())) {
            throw new ConflictException("Only a verified identity can be revoked");
        }
        requireNoOpenQaByMaker(reviewer, v);
        Instant now = Instant.now(clock);
        String reason = body.reason().trim();
        requireReasonLength(reason);
        revokeVerified(reviewer, v, reason, now);
        return read.currentReview(reviewer, v);
    }

    void revokeVerified(AuthPrincipal reviewer, IdentityVerification v, String reason, Instant now) {
        v.setStatus(VerificationStatuses.REVOKED);
        v.setRevokedAt(now);
        v.setRevokedBy(reviewer.userId());
        v.setRevocationReason(reason);
        v.setDecidedAt(now);
        v.setClaimedBy(null);
        v.setClaimedAt(null);

        User user = users.findById(v.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));
        user.setVerified(false);
        users.saveAndFlush(user);
        verifications.saveAndFlush(v);
        int listings = ownerBadge.markOwnerUnverified(user.getId());
        log.info("identity revoked user={} reviewer={} listingsCleared={}", user.getId(), reviewer.userId(), listings);
        UUID userId = user.getId();
        String mobile = user.getMobile();
        notifier.notify(userId, "identity.revoked", "Verified badge withdrawn", reason, "/verify-identity");
        afterCommit(() -> decisionMessenger.sendIdentityDecision(mobile,
                "Your Draazy verified badge was withdrawn. Open the app to see the reason and submit again."));
        recordAudit(reviewer, "identity.verification.revoked", v,
                "reason", reason, "userId", v.getUserId().toString());
    }

    private void requireFreshClaimHolderOrUnclaimed(AuthPrincipal reviewer, IdentityVerification v) {
        if (reviewer != null && isFreshClaim(v, Instant.now(clock)) && !reviewer.userId().equals(v.getClaimedBy())) {
            throwClaimed(v);
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

    private boolean shouldSampleQa(IdentityVerification v) {
        return !"passed".equals(v.getLiveness())
                || v.getLivenessChallenge() == null
                || v.isNumberOverridden()
                || isResubmission(v)
                || ThreadLocalRandom.current().nextDouble() < qaSampleRate;
    }

    private static boolean isResubmission(IdentityVerification v) {
        return v.getAttemptCount() > 1
                || (v.getCreatedAt() != null
                && v.getSubmittedAt() != null
                && v.getSubmittedAt().isAfter(v.getCreatedAt().plus(Duration.ofSeconds(1))));
    }

    private static String normaliseName(String value) {
        String normalised = Normalizer.normalize(value, Normalizer.Form.NFC);
        normalised.codePoints().forEach(codePoint -> {
            int type = Character.getType(codePoint);
            if (type == Character.CONTROL || type == Character.FORMAT && !isAllowedJoiner(codePoint)) {
                throw new BadRequestException("name must not contain control or format characters");
            }
        });
        String stripped = normalised.strip().replaceAll("\\p{Z}+", " ");
        if (!stripped.isEmpty()
                && (isAllowedJoiner(stripped.codePointAt(0))
                || isAllowedJoiner(stripped.codePointBefore(stripped.length())))) {
            throw new BadRequestException("name must not start or end with a joiner");
        }
        if (stripped.length() < 2 || stripped.length() > MAX_NAME_CHARS) {
            throw new BadRequestException("name must be between 2 and 80 characters");
        }
        return stripped;
    }

    private static boolean isAllowedJoiner(int codePoint) {
        return codePoint == '\u200C' || codePoint == '\u200D';
    }

    private void validateStaffReject(IdentityRejectRequest body) {
        if (IdentityRejectRequest.NOT_REVIEWED.equals(body.reason())) {
            throw new BadRequestException("not_reviewed is reserved for the stale-pending sweep");
        }
        if (!IdentityRejectRequest.STAFF_REASONS.contains(body.reason())) {
            throw new BadRequestException("reason must be one of " + IdentityRejectRequest.STAFF_REASONS);
        }
        String note = body.note() == null ? "" : body.note().trim();
        if (IdentityRejectRequest.NOTE_REQUIRED_REASONS.contains(body.reason()) && note.length() < 10) {
            throw new BadRequestException("note must be at least 10 characters for " + body.reason());
        }
    }

    static void requireReasonLength(String reason) {
        if (reason.length() < 10 || reason.length() > 300) {
            throw new BadRequestException("reason must be between 10 and 300 characters");
        }
    }

    private static void requireNoOpenQaByMaker(AuthPrincipal reviewer, IdentityVerification v) {
        if (reviewer != null
                && v.getReviewerId() != null
                && reviewer.userId().equals(v.getReviewerId())
                && v.getQaSampledAt() != null
                && v.getQaReviewedAt() == null) {
            throw new ConflictException(ErrorCodes.IDENTITY_QA_OPEN,
                    "This sampled approval is still awaiting QA review");
        }
    }

    private void flushIdentityHash() {
        try {
            verifications.flush();
        } catch (DataIntegrityViolationException violation) {
            if (ConstraintViolations.isOn(violation, IDENTITY_HASH_CONSTRAINT)) {
                throw new IdentityAlreadyRegisteredException(
                        "This document is already verified on another account");
            }
            throw violation;
        }
    }

    private static void afterCommit(Runnable callback) {
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

    private record ConfirmedDob(LocalDate value, boolean yearOnly) {
    }

    private ConfirmedDob confirmedDob(IdentityApproveRequest body) {
        boolean hasDob = body.dob() != null;
        boolean hasYear = body.birthYear() != null;
        if (hasDob == hasYear) {
            throw new BadRequestException("Exactly one of dob or birthYear is required");
        }
        LocalDate today = LocalDate.now(clock.withZone(PlatformTime.IST));
        if (hasDob) {
            if (body.dob().isAfter(today)) {
                throw new BadRequestException("dob cannot be in the future");
            }
            if (body.dob().plusYears(18).isAfter(today)) {
                throw new BadRequestException("holder must be at least 18 years old");
            }
            return new ConfirmedDob(body.dob(), false);
        }
        int currentYear = today.getYear();
        if (body.birthYear() < 1900 || body.birthYear() > currentYear - 19) {
            throw new BadRequestException("birthYear must be between 1900 and " + (currentYear - 19));
        }
        return new ConfirmedDob(LocalDate.of(body.birthYear(), 1, 1), true);
    }

    static void requireOtherPerson(AuthPrincipal reviewer, IdentityVerification v, String message) {
        if (reviewer != null && reviewer.userId().equals(v.getUserId())) {
            throw new ForbiddenException(message);
        }
    }

    void recordAudit(AuthPrincipal actor, String action, IdentityVerification v, Object... context) {
        if (actor == null) {
            audit.record(SYSTEM_ACTOR_ID, SYSTEM_ACTOR_ROLE, action, "identity_verification", v.getId().toString());
            return;
        }
        audit.record(actor, action, "identity_verification", v.getId().toString(), context);
    }

    private void recordUserNameAudit(AuthPrincipal actor, UUID userId, String before, String after, UUID reviewId) {
        if (actor == null) {
            audit.record(SYSTEM_ACTOR_ID, SYSTEM_ACTOR_ROLE, "user.name.set_from_identity", "user", userId.toString(),
                    null, "{\"before\":" + jsonString(before) + ",\"after\":" + jsonString(after)
                            + ",\"identityVerificationId\":" + jsonString(reviewId.toString()) + "}");
            return;
        }
        audit.record(actor, "user.name.set_from_identity", "user", userId.toString(),
                "before", before, "after", after, "identityVerificationId", reviewId.toString());
    }

    private static String jsonString(String value) {
        if (value == null) {
            return "null";
        }
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private IdentityVerification require(UUID id) {
        return verifications.findById(id)
                .orElseThrow(() -> new NotFoundException("Verification case not found"));
    }

    IdentityVerification requireForUpdate(UUID id) {
        return verifications.findByIdForUpdate(id)
                .orElseThrow(() -> new NotFoundException("Verification case not found"));
    }

    static void requirePending(IdentityVerification v) {
        if (!VerificationStatuses.PENDING.equals(v.getStatus())) {
            throw new ConflictException("This case has already been decided");
        }
    }

}
