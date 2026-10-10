package com.draazy.api.identity.verification;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.security.AuthPrincipal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.data.domain.Page;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IdentityReviewReadService {

    private static final String SYSTEM_ACTOR_ID = "system";
    private static final String SYSTEM_ACTOR_ROLE = "admin";

    private final IdentityVerificationRepository verifications;
    private final IdentityVerificationFileRepository files;
    private final UserRepository users;
    private final FileStorage storage;
    private final AuditService audit;
    private final Clock clock;

    public IdentityReviewReadService(IdentityVerificationRepository verifications,
            IdentityVerificationFileRepository files, UserRepository users, FileStorage storage,
            AuditService audit, Clock clock) {
        this.verifications = verifications;
        this.files = files;
        this.users = users;
        this.storage = storage;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public IdentityReviewResponse detail(AuthPrincipal actor, IdentityVerification v) {
        List<IdentityVerificationFile> stored = files.findByVerificationId(v.getId());
        recordAudit(actor, "identity.verification.viewed", v, "files", String.valueOf(stored.size()));
        return review(actor, v, stored);
    }

    IdentityReviewResponse currentReview(AuthPrincipal actor, IdentityVerification v) {
        return review(actor, v, files.findByVerificationId(v.getId()));
    }

    private IdentityReviewResponse review(AuthPrincipal actor, IdentityVerification v,
            List<IdentityVerificationFile> stored) {
        Map<UUID, User> byId = usersFor(List.of(v));
        return toReview(v, byId::get, actor == null ? null : actor.userId(), stored);
    }

    Page<IdentityReviewRow> toRowPage(AuthPrincipal actor, Page<IdentityVerification> page) {
        Map<UUID, User> byId = usersFor(page.getContent());
        UUID actorId = actor == null ? null : actor.userId();
        return page.map(v -> toRow(v, byId::get, actorId));
    }

    private void recordAudit(AuthPrincipal actor, String action, IdentityVerification v, Object... context) {
        if (actor == null) {
            audit.record(SYSTEM_ACTOR_ID, SYSTEM_ACTOR_ROLE, action, "identity_verification", v.getId().toString());
            return;
        }
        audit.record(actor, action, "identity_verification", v.getId().toString(), context);
    }

    private Map<UUID, User> usersFor(List<IdentityVerification> rows) {
        List<UUID> ids = new ArrayList<>();
        for (IdentityVerification v : rows) {
            ids.add(v.getUserId());
            if (v.getReviewerId() != null) {
                ids.add(v.getReviewerId());
            }
            if (v.getRevokedBy() != null) {
                ids.add(v.getRevokedBy());
            }
            if (v.getClaimedBy() != null) {
                ids.add(v.getClaimedBy());
            }
            if (v.getQaReviewedBy() != null) {
                ids.add(v.getQaReviewedBy());
            }
        }
        Map<UUID, User> byId = new HashMap<>();
        users.findAllById(ids).forEach(u -> byId.put(u.getId(), u));
        return byId;
    }

    private IdentityReviewRow toRow(IdentityVerification v, Function<UUID, User> lookup, UUID actorId) {
        User user = lookup.apply(v.getUserId());
        User reviewer = v.getReviewerId() == null ? null : lookup.apply(v.getReviewerId());
        boolean freshClaim = isFreshClaim(v);
        User claimedBy = freshClaim ? lookup.apply(v.getClaimedBy()) : null;
        boolean hideQa = actorId != null && actorId.equals(v.getReviewerId());
        return new IdentityReviewRow(
                v.getId(),
                v.getStatus(),
                user == null ? null : user.getName(),
                user == null ? null : user.getMobile(),
                v.getDocType(),
                v.getSubmittedAt(),
                v.getDecidedAt(),
                v.getRevokedAt(),
                reviewer == null ? null : reviewer.getName(),
                claimedBy == null ? null : claimedBy.getName(),
                freshClaim && actorId != null && actorId.equals(v.getClaimedBy()),
                hideQa ? null : v.getQaSampledAt());
    }

    private IdentityReviewResponse toReview(IdentityVerification v, Function<UUID, User> lookup, UUID actorId,
            List<IdentityVerificationFile> stored) {
        User user = lookup.apply(v.getUserId());
        User reviewer = v.getReviewerId() == null ? null : lookup.apply(v.getReviewerId());
        User revokedBy = v.getRevokedBy() == null ? null : lookup.apply(v.getRevokedBy());
        boolean freshClaim = isFreshClaim(v);
        User claimedBy = freshClaim ? lookup.apply(v.getClaimedBy()) : null;
        User qaReviewedBy = v.getQaReviewedBy() == null ? null : lookup.apply(v.getQaReviewedBy());
        boolean claimedByMe = freshClaim && actorId != null && actorId.equals(v.getClaimedBy());
        boolean hideQa = actorId != null && actorId.equals(v.getReviewerId());
        return new IdentityReviewResponse(
                v.getId(),
                v.getUserId(),
                user == null ? null : user.getName(),
                user == null ? null : user.getName(),
                user == null ? null : user.getEmail(),
                user == null ? null : user.getMobile(),
                user == null ? null : user.getRole(),
                v.getStatus(),
                v.getDocType(),
                new IdentityReviewResponse.Claims(v.getClaimedNumberLast4(), v.getClaimedName(), v.getClaimedDob()),
                v.getHolderName(),
                v.getHolderDob(),
                v.isHolderDobYearOnly(),
                v.getLiveness(),
                v.getLivenessChallenge() != null ? "challenge" : (v.getLiveness() == null ? null : "client"),
                v.getLivenessChallenge(),
                v.isNumberOverridden(),
                v.getAttemptCount(),
                v.getSubmittedAt(),
                v.getDecidedAt(),
                reviewer == null ? null : reviewer.getName(),
                reviewer == null ? null : reviewer.getName(),
                v.getRejectionReason(),
                v.getRejectionNote(),
                v.getRevokedAt(),
                revokedBy == null ? null : revokedBy.getName(),
                v.getRevocationReason(),
                claimedBy == null ? null : claimedBy.getName(),
                claimedByMe,
                hideQa ? null : v.getQaSampledAt(),
                hideQa ? null : v.getQaReviewedAt(),
                hideQa ? null : v.getQaOutcome(),
                hideQa || qaReviewedBy == null ? null : qaReviewedBy.getName(),

                v.getQaSampledAt() != null && v.getQaReviewedAt() == null,
                v.getFilesPurgedAt(),
                images(stored),
                warnings(v));
    }

    private boolean isFreshClaim(IdentityVerification v) {
        return v.getClaimedBy() != null
                && v.getClaimedAt() != null
                && v.getClaimedAt().isAfter(Instant.now(clock).minus(IdentityReviewClaimService.CLAIM_TTL));
    }

    private IdentityReviewResponse.Images images(List<IdentityVerificationFile> stored) {
        String front = null;
        String back = null;
        String selfie = null;
        for (IdentityVerificationFile f : stored) {
            String url = storage.signedDownloadUrl(f.getStorageKey());
            switch (f.getKind()) {
                case IdentityVerificationFile.FRONT -> front = url;
                case IdentityVerificationFile.BACK -> back = url;
                case IdentityVerificationFile.SELFIE -> selfie = url;
                default -> {
                }
            }
        }
        return new IdentityReviewResponse.Images(front, back, selfie);
    }

    private List<IdentityReviewResponse.Warning> warnings(IdentityVerification v) {
        List<Hit> hits = new ArrayList<>();
        if (v.getClaimedHash() != null) {
            verifications.findByIdentityHash(v.getClaimedHash())
                    .filter(o -> !o.getId().equals(v.getId()))
                    .ifPresent(o -> hits.add(new Hit("same_document_verified", o)));
            for (IdentityVerification o : verifications.findByClaimedHash(v.getClaimedHash())) {
                if (!o.getId().equals(v.getId()) && !VerificationStatuses.VERIFIED.equals(o.getStatus())) {
                    hits.add(new Hit("same_document_claimed", o));
                }
            }
        }
        if (v.getPersonKey() != null) {
            for (IdentityVerification o : verifications.findByPersonKey(v.getPersonKey())) {
                if (!o.getId().equals(v.getId())) {
                    hits.add(new Hit("same_person_key", o));
                }
            }
        }
        if (hits.isEmpty()) {
            return List.of();
        }
        Map<UUID, String> names = new HashMap<>();
        users.findAllById(hits.stream().map(h -> h.other().getUserId()).distinct().toList())
                .forEach(u -> names.put(u.getId(), u.getName()));
        return hits.stream()
                .map(h -> new IdentityReviewResponse.Warning(h.kind(), h.other().getUserId(),
                        names.get(h.other().getUserId()), h.other().getId()))
                .toList();
    }

    private record Hit(String kind, IdentityVerification other) {
    }
}
