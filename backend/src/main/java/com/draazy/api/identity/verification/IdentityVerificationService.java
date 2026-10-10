package com.draazy.api.identity.verification;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.IdentityAlreadyRegisteredException;
import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.common.trust.OwnerBadgeSink;
import com.draazy.api.common.validation.MediaSignatures;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.DecisionMessenger;
import com.draazy.api.provider.DocumentScanner;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.security.AuthPrincipal;
import java.time.Clock;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

@Service
public class IdentityVerificationService {

    static final int MAX_ATTEMPTS_PER_WINDOW = 3;
    static final Duration ATTEMPT_WINDOW = Duration.ofHours(24);
    static final String CONSENT_NOTICE_VERSION = "2026-09";
    private static final int PURGE_BATCH = 200;
    private static final int STALE_BATCH = 200;
    private static final Set<String> CONSENT_LANGUAGES = Set.of("en", "hi", "mr");
    private static final String STALE_NOTE =
            "We couldn't review this in time. Please submit again — it won't count against your attempts.";

    private final IdentityVerificationRepository verifications;
    private final IdentityVerificationFileRepository files;
    private final IdentityFilePurgeService filePurge;
    private final IdentityConflictService conflicts;
    private final UserRepository users;
    private final FileStorage storage;
    private final List<DocumentScanner> scanners;
    private final IdentityHasher hasher;
    private final ObjectMapper json;
    private final OwnerBadgeSink ownerBadge;
    private final Notifier notifier;
    private final DecisionMessenger decisionMessenger;
    private final AuditService audit;
    private final LivenessCheck livenessCheck;
    private final Clock clock;

    public IdentityVerificationService(IdentityVerificationRepository verifications,
            IdentityVerificationFileRepository files, UserRepository users, FileStorage storage,
            List<DocumentScanner> scanners, IdentityHasher hasher, ObjectMapper json,
            OwnerBadgeSink ownerBadge, Notifier notifier, DecisionMessenger decisionMessenger,
            AuditService audit, IdentityFilePurgeService filePurge, IdentityConflictService conflicts,
            LivenessCheck livenessCheck, Clock clock) {
        this.verifications = verifications;
        this.files = files;
        this.filePurge = filePurge;
        this.conflicts = conflicts;
        this.users = users;
        this.storage = storage;
        this.scanners = scanners;
        this.hasher = hasher;
        this.json = json;
        this.ownerBadge = ownerBadge;
        this.notifier = notifier;
        this.decisionMessenger = decisionMessenger;
        this.audit = audit;
        this.livenessCheck = livenessCheck;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public IdentityVerificationResponse status(UUID userId) {
        return verifications.findByUserId(userId)
                .map(v -> toStatus(v, Instant.now(clock)))
                .orElse(new IdentityVerificationResponse(VerificationStatuses.NONE, null, null, null,
                        null, null, null, null, null, MAX_ATTEMPTS_PER_WINDOW, null));
    }

    @Transactional(readOnly = true)
    public boolean isVerified(UUID userId) {
        return verifications.findByUserId(userId)
                .map(v -> VerificationStatuses.VERIFIED.equals(v.getStatus()))
                .orElse(false);
    }

    @Transactional(readOnly = true)
    public Set<UUID> verifiedAmong(java.util.Collection<UUID> userIds) {
        if (userIds.isEmpty()) {
            return Set.of();
        }
        return Set.copyOf(verifications.userIdsWithStatus(userIds, VerificationStatuses.VERIFIED));
    }

    @Transactional
    public IdentityVerificationResponse submit(UUID userId, String docType, boolean consent,
            String consentLanguage, String claimsJson, String liveness, String challenge,
            MultipartFile front, MultipartFile back, MultipartFile selfie) {
        if (!consent) {
            throw new ValidationException("consent must be true");
        }
        if (docType == null || !IdentityDocTypes.ALL.contains(docType)) {
            throw new ValidationException("docType must be one of " + IdentityDocTypes.ALL);
        }
        requireFile(front, "front");
        requireFile(selfie, "selfie");
        boolean hasBack = back != null && !back.isEmpty();
        if (IdentityDocTypes.requiresBack(docType) && !hasBack) {
            throw new ValidationException("back is required for " + docType);
        }
        if (!IdentityDocTypes.requiresBack(docType) && hasBack) {
            throw new ValidationException("back is not accepted for " + docType);
        }
        String language = normaliseConsentLanguage(consentLanguage);
        String livenessValue = LivenessCheck.normaliseLiveness(liveness);
        String pose = livenessCheck.verify(userId, challenge);
        Instant now = Instant.now(clock);

        IdentityVerification v = verifications.findByUserIdForUpdate(userId).orElse(null);
        if (v != null) {
            if (VerificationStatuses.VERIFIED.equals(v.getStatus())) {
                throw new ConflictException("Identity is already verified");
            }
            if (VerificationStatuses.PENDING.equals(v.getStatus())) {
                throw new ConflictException("A submission is already awaiting review");
            }
            countAttempt(v, now);
        }

        ParsedClaims claims = parseClaims(docType, claimsJson);
        rejectIfAlreadyVerifiedElsewhere(userId, docType, claims.hash());
        List<PreparedImage> images = new ArrayList<>();
        images.add(prepareImage(IdentityVerificationFile.FRONT, front));
        if (hasBack) {
            images.add(prepareImage(IdentityVerificationFile.BACK, back));
        }
        images.add(prepareImage(IdentityVerificationFile.SELFIE, selfie));

        if (v == null) {
            v = verifications.save(new IdentityVerification(userId, docType, now));
        } else {
            filePurge.purgeFiles(v);
            v.resetForResubmission(docType, now);
        }
        applyClaims(v, claims);
        v.setLiveness(livenessValue);
        v.setLivenessChallenge(pose);
        v.setConsentNoticeVersion(CONSENT_NOTICE_VERSION);
        v.setConsentLanguage(language);
        for (PreparedImage image : images) {
            storeImage(v, image);
        }
        return toStatus(v, now);
    }

    private static String normaliseConsentLanguage(String consentLanguage) {
        if (consentLanguage == null || consentLanguage.isBlank()) {
            return "en";
        }
        String value = consentLanguage.trim();
        if (!CONSENT_LANGUAGES.contains(value)) {
            throw new BadRequestException("consentLanguage must be one of " + CONSENT_LANGUAGES);
        }
        return value;
    }

    private void rejectIfAlreadyVerifiedElsewhere(UUID userId, String docType, String claimedHash) {
        if (claimedHash == null) {
            return;
        }
        verifications.findByIdentityHash(claimedHash)
                .filter(holder -> !holder.getUserId().equals(userId))
                .ifPresent(holder -> {
                    conflicts.recordOrRateLimit(userId, docType, claimedHash, holder.getId());
                    throw new IdentityAlreadyRegisteredException(
                            "This document is already verified on another account");
                });
    }

    private static void requireFile(MultipartFile file, String field) {
        if (file == null || file.isEmpty()) {
            throw new ValidationException(field + " image is required");
        }
    }

    private void countAttempt(IdentityVerification v, Instant now) {
        Instant windowEnd = v.getAttemptWindowStart().plus(ATTEMPT_WINDOW);
        if (!now.isBefore(windowEnd)) {
            v.setAttemptWindowStart(now);
            v.setAttemptCount(1);
            return;
        }
        if (v.getAttemptCount() >= MAX_ATTEMPTS_PER_WINDOW) {
            int retryAfter = (int) Math.max(1, Duration.between(now, windowEnd).toSeconds());
            throw new RateLimitedException("rate_limited",
                    "Too many attempts. Try again after the 24-hour window resets.", retryAfter);
        }
        v.setAttemptCount(v.getAttemptCount() + 1);
    }

    private record ParsedClaims(IdentityVerificationResponse.Claims claims, String hash, String last4) {
        static final ParsedClaims NONE = new ParsedClaims(null, null, null);
    }

    private ParsedClaims parseClaims(String docType, String claimsJson) {
        if (claimsJson == null || claimsJson.isBlank()) {
            return ParsedClaims.NONE;
        }
        IdentityVerificationResponse.Claims claims;
        try {
            claims = json.readValue(claimsJson, IdentityVerificationResponse.Claims.class);
        } catch (JacksonException e) {
            throw new ValidationException("claims must be a JSON object {number, name, dob}");
        }
        return IdentityNumbers.canonical(docType, claims.number())
                .map(n -> new ParsedClaims(claims, hasher.docHash(docType, n), IdentityNumbers.last4(n)))
                .orElseGet(() -> new ParsedClaims(claims, null, null));
    }

    private void applyClaims(IdentityVerification v, ParsedClaims parsed) {
        IdentityVerificationResponse.Claims claims = parsed.claims();
        if (claims == null) {
            return;
        }
        if (parsed.hash() != null) {
            v.setClaimedHash(parsed.hash());
            v.setClaimedNumberLast4(parsed.last4());
        }
        if (claims.name() != null && !claims.name().isBlank()) {
            v.setClaimedName(claims.name().trim());
        }
        v.setClaimedDob(claims.dob());
        v.setPersonKey(hasher.personKey(v.getClaimedName(), v.getClaimedDob()));
    }

    private record PreparedImage(String kind, byte[] bytes, String contentType) {
    }

    private static final long MAX_IMAGE_BYTES = 1_000_000L;

    private static final List<String> ALLOWED_IMAGE_TYPES =
            List.of(MediaSignatures.JPEG, MediaSignatures.PNG, MediaSignatures.HEIC);

    private static String provePhoto(String kind, String declaredType, byte[] bytes) {
        String declared = switch (MediaSignatures.normalise(declaredType)) {
            case "image/jpg" -> MediaSignatures.JPEG;
            case "image/heif" -> MediaSignatures.HEIC;
            case String type -> type;
        };
        String sniffed = MediaSignatures.sniff(bytes);
        if (!ALLOWED_IMAGE_TYPES.contains(declared) || !declared.equals(sniffed)) {
            throw new UnsupportedMediaTypeException(
                    kind + " must be a photo (JPEG, PNG or HEIC) taken with the camera");
        }
        return sniffed;
    }

    private PreparedImage prepareImage(String kind, MultipartFile file) {
        if (file.getSize() >= MAX_IMAGE_BYTES) {
            throw new PayloadTooLargeException("Images must be smaller than 1,000,000 bytes (1 MB)");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read uploaded image", e);
        }
        if (bytes.length >= MAX_IMAGE_BYTES) {
            throw new PayloadTooLargeException("Images must be smaller than 1,000,000 bytes (1 MB)");
        }
        String provedType = provePhoto(kind, file.getContentType(), bytes);
        for (DocumentScanner scanner : scanners) {
            DocumentScanner.Verdict verdict = scanner.scan(kind, provedType, bytes);
            switch (verdict.outcome()) {
                case CLEAN -> {
                }
                case TOO_LARGE -> throw new PayloadTooLargeException(verdict.detail());
                case REJECTED -> throw new UnsupportedMediaTypeException(verdict.detail());
                default -> throw new IllegalStateException("unhandled scan outcome " + verdict.outcome());
            }
        }
        return new PreparedImage(kind, bytes, provedType);
    }

    private void storeImage(IdentityVerification v, PreparedImage image) {
        String key = "identity/" + v.getUserId() + "/" + v.getId() + "/"
                + image.kind() + "-" + UUID.randomUUID() + extension(image.contentType());
        storage.store(key, image.bytes(), image.contentType());
        filePurge.deleteIfRolledBack(key);
        files.save(new IdentityVerificationFile(v.getId(), image.kind(), key, image.contentType(),
                image.bytes().length));
    }

    private static String extension(String contentType) {
        return switch (contentType) {
            case MediaSignatures.PNG -> ".png";
            case MediaSignatures.HEIC -> ".heic";
            default -> ".jpg";
        };
    }

    private IdentityVerificationResponse toStatus(IdentityVerification v, Instant now) {
        if (VerificationStatuses.WITHDRAWN.equals(v.getStatus())) {
            return new IdentityVerificationResponse(VerificationStatuses.NONE, null, null, null,
                    null, null, null, null, null, MAX_ATTEMPTS_PER_WINDOW, null);
        }
        Instant windowEnd = v.getAttemptWindowStart().plus(ATTEMPT_WINDOW);
        int used = now.isBefore(windowEnd) ? v.getAttemptCount() : 0;
        int remaining = Math.max(0, MAX_ATTEMPTS_PER_WINDOW - used);
        boolean open = VerificationStatuses.REJECTED.equals(v.getStatus())
                || VerificationStatuses.REVOKED.equals(v.getStatus());
        return new IdentityVerificationResponse(
                v.getStatus(),
                v.getDocType(),
                v.getDocLast4(),
                v.getSubmittedAt(),
                v.getDecidedAt(),
                v.getRejectionReason(),
                v.getRejectionNote(),
                v.getRevokedAt(),
                v.getRevocationReason(),
                open ? remaining : 0,
                open && remaining == 0 ? windowEnd : null);
    }

    @Transactional
    public int purgeExpiredFiles(int retentionDays) {
        Instant cutoff = Instant.now(clock).minus(Duration.ofDays(retentionDays));
        List<IdentityVerification> due = verifications.findPurgeCandidates(cutoff, PageRequest.of(0, PURGE_BATCH));
        Instant now = Instant.now(clock);
        for (IdentityVerification v : due) {
            filePurge.purgeFiles(v);
            v.setFilesPurgedAt(now);
        }
        return due.size();
    }

    @Transactional
    int expireStalePending(Duration ttl) {
        Instant now = Instant.now(clock);
        List<IdentityVerification> due = verifications.findStalePendingForUpdate(
                now.minus(ttl), now.minus(IdentityReviewClaimService.CLAIM_TTL), PageRequest.of(0, STALE_BATCH));
        for (IdentityVerification v : due) {
            v.setStatus(VerificationStatuses.REJECTED);
            v.setRejectionReason(IdentityRejectRequest.NOT_REVIEWED);
            v.setRejectionNote(STALE_NOTE);
            v.setReviewerId(null);
            v.setDecidedAt(now);
            v.setAttemptCount(0);
            v.setAttemptWindowStart(now);
            filePurge.purgeFiles(v);
            v.setFilesPurgedAt(now);
            notifyRejected(v.getUserId(), STALE_NOTE);
            audit.record("system", "admin", "identity.verification.expired", "identity_verification",
                    v.getId().toString(), null, "{\"reason\":\"not_reviewed\"}");
        }
        return due.size();
    }

    @Transactional
    public int erase(UUID userId) {
        return verifications.findByUserId(userId).map(v -> {
            filePurge.purgeFiles(v);
            verifications.delete(v);
            return 1;
        }).orElse(0);
    }

    @Transactional
    public void withdraw(AuthPrincipal actor) {
        IdentityVerification v = verifications.findByUserIdForUpdate(actor.userId()).orElse(null);
        if (v == null) {
            audit.record(actor, "identity.verification.withdrawn", "identity_verification",
                    actor.userId().toString(), "status", VerificationStatuses.NONE);
            return;
        }
        if (VerificationStatuses.WITHDRAWN.equals(v.getStatus())) {
            audit.record(actor, "identity.verification.withdrawn", "identity_verification",
                    v.getId().toString(), "status", v.getStatus());
            return;
        }
        String previousStatus = v.getStatus();
        if (VerificationStatuses.VERIFIED.equals(v.getStatus())) {
            clearBadge(actor.userId());
        }
        filePurge.purgeFiles(v);
        v.setFilesPurgedAt(Instant.now(clock));
        withdrawCase(v);
        verifications.saveAndFlush(v);
        audit.record(actor, "identity.verification.withdrawn", "identity_verification",
                v.getId().toString(), "status", previousStatus);
    }

    private void withdrawCase(IdentityVerification v) {
        boolean keepFraudTombstone = VerificationStatuses.REVOKED.equals(v.getStatus())
                || (VerificationStatuses.REJECTED.equals(v.getStatus())
                && "not_holder".equals(v.getRejectionReason()));
        v.setClaimedNumberLast4(null);
        v.setClaimedName(null);
        v.setClaimedDob(null);
        v.setClaimedHash(null);
        v.setDocLast4(null);
        v.setHolderName(null);
        v.setHolderDob(null);
        v.setHolderDobYearOnly(false);
        v.setLiveness(null);
        v.setLivenessChallenge(null);
        v.setNumberOverridden(false);
        v.setRejectionNote(null);
        v.setRevokedAt(null);
        v.setRevokedBy(null);
        v.setRevocationReason(null);
        if (!keepFraudTombstone) {
            v.setIdentityHash(null);
            v.setPersonKey(null);
        }
        v.setStatus(VerificationStatuses.WITHDRAWN);
    }

    void clearBadge(UUID userId) {
        User user = users.findById(userId).orElse(null);
        if (user != null) {
            user.setVerified(false);
        }
        ownerBadge.markOwnerUnverified(userId);
    }

    void notifyRejected(UUID userId, String text) {
        notifier.notify(userId, "identity.rejected", "Verification needs another try",
                text, "/verify-identity");
        users.findById(userId).filter(user -> notifier.allowsWhatsapp(userId)).ifPresent(user ->
                decisionMessenger.sendIdentityDecision(user.getMobile(),
                        "Your Draazy identity verification could not be completed. Open the app to see the reason and retake your photos."));
    }
}
