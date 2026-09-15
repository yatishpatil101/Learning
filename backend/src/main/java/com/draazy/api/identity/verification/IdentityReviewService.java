package com.draazy.api.identity.verification;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.IdentityAlreadyRegisteredException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.trust.OwnerBadgeSink;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.DecisionMessenger;
import com.draazy.api.provider.FileStorage;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Staff side of the identity badge: read a queued case and grant or refuse it. Badge keys off what
 * the reviewer reads (UNIQUE {@code identity_hash} written at {@link #approve}, never at submit).
 */
@Service
public class IdentityReviewService {

    private static final Logger log = LoggerFactory.getLogger(IdentityReviewService.class);

    private static final int HASH_PREFIX_CHARS = 12;

    /** Where the approval notice sends the applicant: the badge is shown on their dashboard. */
    private static final String VERIFIED_BADGE_LINK = "/dashboard";

    private final IdentityVerificationRepository verifications;
    private final IdentityVerificationFileRepository files;
    private final UserRepository users;
    private final FileStorage storage;
    private final IdentityHasher hasher;
    private final OwnerBadgeSink ownerBadge;
    private final Notifier notifier;
    private final DecisionMessenger decisionMessenger;

    public IdentityReviewService(IdentityVerificationRepository verifications,
            IdentityVerificationFileRepository files, UserRepository users, FileStorage storage,
            IdentityHasher hasher, OwnerBadgeSink ownerBadge, Notifier notifier,
            DecisionMessenger decisionMessenger) {
        this.verifications = verifications;
        this.files = files;
        this.users = users;
        this.storage = storage;
        this.hasher = hasher;
        this.ownerBadge = ownerBadge;
        this.notifier = notifier;
        this.decisionMessenger = decisionMessenger;
    }

    @Transactional(readOnly = true)
    public Page<IdentityReviewResponse> queue(String status, Pageable pageable) {
        Page<IdentityVerification> page = status == null || status.isBlank()
                ? verifications.findAllByOrderBySubmittedAtDesc(pageable)
                : verifications.findByStatusOrderBySubmittedAtAsc(status, pageable);
        Map<UUID, User> byId = usersFor(page.getContent());
        return page.map(v -> toReview(v, byId::get, false));
    }

    @Transactional(readOnly = true)
    public IdentityReviewResponse detail(UUID id) {
        IdentityVerification v = require(id);
        Map<UUID, User> byId = usersFor(List.of(v));
        return toReview(v, byId::get, true);
    }

    /**
     * Grants the badge from the reviewer's own reading of the card; number is format-checked,
     * hashed, and dedup'd against every approved case. 422 on bad number, 409 on dup or non-pending.
     */
    @Transactional
    public IdentityReviewResponse approve(UUID reviewerId, UUID id, IdentityApproveRequest body) {
        IdentityVerification v = requireForUpdate(id);
        requirePending(v);
        String canonical = IdentityNumbers.canonical(v.getDocType(), body.number())
                .orElseThrow(() -> new ValidationException(
                        "number is not a valid " + v.getDocType() + " number"));
        String hash = hasher.docHash(v.getDocType(), canonical);
        Optional<IdentityVerification> holder = verifications.findByIdentityHash(hash);
        if (holder.isPresent() && !holder.get().getId().equals(v.getId())) {
            throw new IdentityAlreadyRegisteredException(
                    "This document is already verified on another account");
        }
        Instant now = Instant.now();
        v.setIdentityHash(hash);
        v.setDocLast4(IdentityNumbers.last4(canonical));
        v.setHolderName(body.name().trim());
        v.setHolderDob(body.dob());
        v.setPersonKey(hasher.personKey(v.getHolderName(), v.getHolderDob()));
        v.setStatus(VerificationStatuses.VERIFIED);
        v.setReviewerId(reviewerId);
        v.setDecidedAt(now);

        User user = users.findById(v.getUserId())
                .orElseThrow(() -> new NotFoundException("User not found"));
        user.setVerified(true);
        int listings = ownerBadge.markOwnerVerified(user.getId());
        log.info("identity approved user={} reviewer={} listingsStamped={}", user.getId(), reviewerId, listings);

        notifier.notify(user.getId(), "identity.approved", "You're verified",
                "Your identity has been confirmed. Your profile now carries the verified badge.",
                VERIFIED_BADGE_LINK);
        decisionMessenger.sendIdentityDecision(user.getMobile(),
                "Your Draazy identity verification is approved. Your profile now shows the verified badge.");
        return toReview(v, uid -> user, true);
    }

    @Transactional
    public IdentityReviewResponse reject(UUID reviewerId, UUID id, IdentityRejectRequest body) {
        if (!IdentityRejectRequest.REASONS.contains(body.reason())) {
            throw new ValidationException("reason must be one of " + IdentityRejectRequest.REASONS);
        }
        IdentityVerification v = requireForUpdate(id);
        requirePending(v);
        v.setStatus(VerificationStatuses.REJECTED);
        v.setRejectionReason(body.reason());
        v.setRejectionNote(body.note() == null || body.note().isBlank() ? null : body.note().trim());
        v.setReviewerId(reviewerId);
        v.setDecidedAt(Instant.now());

        User user = users.findById(v.getUserId()).orElse(null);
        notifier.notify(v.getUserId(), "identity.rejected", "Verification needs another try",
                "We couldn't verify your ID this time. Open the verification page to see why and retake.",
                "/verify-identity");
        if (user != null) {
            decisionMessenger.sendIdentityDecision(user.getMobile(),
                    "Your Draazy identity verification could not be completed. Open the app to see the reason and retake your photos.");
        }
        return toReview(v, uid -> user, true);
    }

    // ---------------------------------------------------------------- mapping

    private IdentityVerification require(UUID id) {
        return verifications.findById(id)
                .orElseThrow(() -> new NotFoundException("Verification case not found"));
    }

    /** A decision serialises on the row, or two reviewers both pass {@link #requirePending}. */
    private IdentityVerification requireForUpdate(UUID id) {
        return verifications.findByIdForUpdate(id)
                .orElseThrow(() -> new NotFoundException("Verification case not found"));
    }

    private static void requirePending(IdentityVerification v) {
        if (!VerificationStatuses.PENDING.equals(v.getStatus())) {
            throw new ConflictException("This case has already been decided");
        }
    }

    private Map<UUID, User> usersFor(List<IdentityVerification> rows) {
        List<UUID> ids = new ArrayList<>();
        for (IdentityVerification v : rows) {
            ids.add(v.getUserId());
            if (v.getReviewerId() != null) {
                ids.add(v.getReviewerId());
            }
        }
        Map<UUID, User> byId = new HashMap<>();
        users.findAllById(ids).forEach(u -> byId.put(u.getId(), u));
        return byId;
    }

    private IdentityReviewResponse toReview(IdentityVerification v, Function<UUID, User> lookup,
            boolean withDetail) {
        User user = lookup.apply(v.getUserId());
        User reviewer = v.getReviewerId() == null ? null : lookup.apply(v.getReviewerId());
        String hashPrefix = v.getClaimedHash() == null ? null
                : v.getClaimedHash().substring(0, HASH_PREFIX_CHARS);
        return new IdentityReviewResponse(
                v.getId(),
                v.getUserId(),
                user == null ? null : user.getName(),
                user == null ? null : user.getMobile(),
                user == null ? null : user.getRole(),
                v.getStatus(),
                v.getDocType(),
                new IdentityReviewResponse.Claims(v.getClaimedNumberLast4(), v.getClaimedName(), v.getClaimedDob()),
                hashPrefix,
                v.getDocLast4(),
                v.getHolderName(),
                v.getHolderDob(),
                v.getAttemptCount(),
                v.getSubmittedAt(),
                v.getDecidedAt(),
                reviewer == null ? null : reviewer.getName(),
                v.getRejectionReason(),
                v.getRejectionNote(),
                v.getFilesPurgedAt(),
                withDetail ? images(v) : null,
                withDetail ? warnings(v) : List.of());
    }

    private IdentityReviewResponse.Images images(IdentityVerification v) {
        String front = null;
        String back = null;
        String selfie = null;
        for (IdentityVerificationFile f : files.findByVerificationId(v.getId())) {
            String url = storage.signedDownloadUrl(f.getStorageKey());
            switch (f.getKind()) {
                case IdentityVerificationFile.FRONT -> front = url;
                case IdentityVerificationFile.BACK -> back = url;
                case IdentityVerificationFile.SELFIE -> selfie = url;
                default -> {
                    // unknown kind: ignore rather than fail the reviewer's read
                }
            }
        }
        return new IdentityReviewResponse.Images(front, back, selfie);
    }

    /** Other accounts this case may collide with; the reviewer decides what they mean. */
    private List<IdentityReviewResponse.Warning> warnings(IdentityVerification v) {
        List<IdentityReviewResponse.Warning> out = new ArrayList<>();
        if (v.getClaimedHash() != null) {
            verifications.findByIdentityHash(v.getClaimedHash())
                    .filter(o -> !o.getId().equals(v.getId()))
                    .ifPresent(o -> out.add(warning("same_document_verified", o)));
            for (IdentityVerification o : verifications.findByClaimedHash(v.getClaimedHash())) {
                if (!o.getId().equals(v.getId()) && !VerificationStatuses.VERIFIED.equals(o.getStatus())) {
                    out.add(warning("same_document_claimed", o));
                }
            }
        }
        if (v.getPersonKey() != null) {
            for (IdentityVerification o : verifications.findByPersonKey(v.getPersonKey())) {
                if (!o.getId().equals(v.getId())) {
                    out.add(warning("same_person_key", o));
                }
            }
        }
        return out;
    }

    private IdentityReviewResponse.Warning warning(String kind, IdentityVerification other) {
        String name = users.findById(other.getUserId()).map(User::getName).orElse(null);
        return new IdentityReviewResponse.Warning(kind, other.getUserId(), name, other.getId());
    }
}
