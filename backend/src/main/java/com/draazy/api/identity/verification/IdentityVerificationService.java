package com.draazy.api.identity.verification;

import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.IdentityAlreadyRegisteredException;
import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.validation.MediaSignatures;
import com.draazy.api.provider.DocumentScanner;
import com.draazy.api.provider.FileStorage;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * Applicant's side of the identity badge: live capture queued for a reviewer. Nothing the client
 * says is believed — the UNIQUE {@code identity_hash} is set only at {@link IdentityReviewService#approve}.
 */
@Service
public class IdentityVerificationService {

    static final int MAX_ATTEMPTS_PER_WINDOW = 3;
    static final Duration ATTEMPT_WINDOW = Duration.ofHours(24);
    private static final int PURGE_BATCH = 200;

    private final IdentityVerificationRepository verifications;
    private final IdentityVerificationFileRepository files;
    private final FileStorage storage;
    private final List<DocumentScanner> scanners;
    private final IdentityHasher hasher;
    private final ObjectMapper json;

    public IdentityVerificationService(IdentityVerificationRepository verifications,
            IdentityVerificationFileRepository files, FileStorage storage,
            List<DocumentScanner> scanners, IdentityHasher hasher, ObjectMapper json) {
        this.verifications = verifications;
        this.files = files;
        this.storage = storage;
        this.scanners = scanners;
        this.hasher = hasher;
        this.json = json;
    }

    // ---------------------------------------------------------------- applicant side

    @Transactional(readOnly = true)
    public IdentityVerificationResponse status(UUID userId) {
        return verifications.findByUserId(userId)
                .map(v -> toStatus(v, Instant.now()))
                .orElse(new IdentityVerificationResponse(VerificationStatuses.NONE, null, null, null,
                        null, null, null, MAX_ATTEMPTS_PER_WINDOW, null));
    }

    /**
     * Whether this user currently holds a reviewer-approved case. The badge flag on the user is the
     * denormalised copy; this is the source of truth admins consult before withdrawing a badge.
     */
    @Transactional(readOnly = true)
    public boolean isVerified(UUID userId) {
        return verifications.findByUserId(userId)
                .map(v -> VerificationStatuses.VERIFIED.equals(v.getStatus()))
                .orElse(false);
    }

    /**
     * Accepts a capture into the queue. Overwrites any earlier case (one row per account) and its
     * images. Throws {@link RateLimitedException} (429) or {@link IdentityAlreadyRegisteredException} (409).
     */
    @Transactional
    public IdentityVerificationResponse submit(UUID userId, String docType, boolean consent,
            String claimsJson, MultipartFile front, MultipartFile back, MultipartFile selfie) {
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
        Instant now = Instant.now();

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

        // All refusals run before purging the earlier case's images: purging first then refusing
        // would leave the row rejected and the photos already gone from the reviewer's view.
        ParsedClaims claims = parseClaims(docType, claimsJson);
        rejectIfAlreadyVerifiedElsewhere(userId, claims.hash());
        List<PreparedImage> images = new ArrayList<>();
        images.add(prepareImage(IdentityVerificationFile.FRONT, front));
        if (hasBack) {
            images.add(prepareImage(IdentityVerificationFile.BACK, back));
        }
        images.add(prepareImage(IdentityVerificationFile.SELFIE, selfie));

        if (v == null) {
            v = verifications.save(new IdentityVerification(userId, docType, now));
        } else {
            purgeFiles(v);
            v.resetForResubmission(docType, now);
        }
        applyClaims(v, claims);
        for (PreparedImage image : images) {
            storeImage(v, image);
        }
        return toStatus(v, now);
    }

    private void rejectIfAlreadyVerifiedElsewhere(UUID userId, String claimedHash) {
        if (claimedHash == null) {
            return;
        }
        verifications.findByIdentityHash(claimedHash)
                .filter(holder -> !holder.getUserId().equals(userId))
                .ifPresent(holder -> {
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

    /** The OCR claim, resolved once so the 409 dedup check can run before the purge. */
    private record ParsedClaims(IdentityVerificationResponse.Claims claims, String hash, String last4) {
        static final ParsedClaims NONE = new ParsedClaims(null, null, null);
    }

    /** Parses the OCR claim; a malformed or absent claim is simply "no claim", never an error. */
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

    /** An image that has passed every check and is waiting only for its case to exist. */
    private record PreparedImage(String kind, byte[] bytes, String contentType) {
    }

    /** Same ceiling as the document vault, restated locally so identity capture does not depend upward. */
    private static final long MAX_IMAGE_BYTES = 1_000_000L;

    /** Camera capture formats only; deliberately narrower than the vault's list (no PDF, no WebP). */
    private static final List<String> ALLOWED_IMAGE_TYPES =
            List.of(MediaSignatures.JPEG, MediaSignatures.PNG, MediaSignatures.HEIC);

    /**
     * Declared type is a claim, leading bytes are evidence; both must land on the allowlist and
     * agree, and the proved type is what gets stored (never the client's string).
     */
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
                    // every scanner gets a look
                }
                case TOO_LARGE -> throw new PayloadTooLargeException(verdict.detail());
                case REJECTED -> throw new UnsupportedMediaTypeException(verdict.detail());
                default -> throw new IllegalStateException("unhandled scan outcome " + verdict.outcome());
            }
        }
        return new PreparedImage(kind, bytes, provedType);
    }

    private void storeImage(IdentityVerification v, PreparedImage image) {
        String key = "identity/" + v.getUserId() + "/" + v.getId() + "/" + image.kind();
        storage.store(key, image.bytes(), image.contentType());
        files.save(new IdentityVerificationFile(v.getId(), image.kind(), key, image.contentType(),
                image.bytes().length));
    }

    private IdentityVerificationResponse toStatus(IdentityVerification v, Instant now) {
        Instant windowEnd = v.getAttemptWindowStart().plus(ATTEMPT_WINDOW);
        int used = now.isBefore(windowEnd) ? v.getAttemptCount() : 0;
        int remaining = Math.max(0, MAX_ATTEMPTS_PER_WINDOW - used);
        boolean open = VerificationStatuses.REJECTED.equals(v.getStatus());
        return new IdentityVerificationResponse(
                v.getStatus(),
                v.getDocType(),
                v.getDocLast4(),
                v.getSubmittedAt(),
                v.getDecidedAt(),
                v.getRejectionReason(),
                v.getRejectionNote(),
                open ? remaining : 0,
                open && remaining == 0 ? windowEnd : null);
    }

    // ---------------------------------------------------------------- retention

    /**
     * Deletes the images of every decided case older than {@code retentionDays}. Rows are kept.
     *
     * @return how many cases were purged, for the sweep's log line
     */
    @Transactional
    public int purgeExpiredFiles(int retentionDays) {
        Instant cutoff = Instant.now().minus(Duration.ofDays(retentionDays));
        List<IdentityVerification> due = verifications.findPurgeCandidates(cutoff, PageRequest.of(0, PURGE_BATCH));
        Instant now = Instant.now();
        for (IdentityVerification v : due) {
            purgeFiles(v);
            v.setFilesPurgedAt(now);
        }
        return due.size();
    }

    private void purgeFiles(IdentityVerification v) {
        for (IdentityVerificationFile f : files.findByVerificationId(v.getId())) {
            storage.delete(f.getStorageKey());
        }
        files.deleteByVerificationId(v.getId());
        // Flush deletes so a retake's inserts don't collide with the old rows on UNIQUE
        // (verification_id, kind) — Hibernate would otherwise order inserts before deletes.
        files.flush();
    }

    /**
     * Account erasure: images, hashes and the row all go. Keeping the dedup hash would let the
     * platform recognise an erased person on return. Returns 1 if a case existed, else 0.
     */
    @Transactional
    public int erase(UUID userId) {
        return verifications.findByUserId(userId).map(v -> {
            purgeFiles(v);
            verifications.delete(v);
            return 1;
        }).orElse(0);
    }
}
