package com.draazy.api.identity.verification;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

// The document number never lands; UNIQUE identityHash is written only at approval.
@Entity
@Table(name = "identity_verifications")
@Getter
public class IdentityVerification extends AuditedEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "status", nullable = false)
    @Setter
    private String status;

    @Column(name = "doc_type", nullable = false)
    @Setter
    private String docType;

    @Column(name = "claimed_number_last4")
    @Setter
    private String claimedNumberLast4;

    @Column(name = "claimed_name")
    @Setter
    private String claimedName;

    @Column(name = "claimed_dob")
    @Setter
    private LocalDate claimedDob;

    /** HMAC of the client's OCR claim. Non-unique: a fake claim must not block a real holder. */
    @Column(name = "claimed_hash")
    @Setter
    private String claimedHash;

    /** HMAC of the reviewer-confirmed number; UNIQUE, so the DB is the last word on dedup. */
    @Column(name = "identity_hash", unique = true)
    @Setter
    private String identityHash;

    @Column(name = "person_key")
    @Setter
    private String personKey;

    @Column(name = "doc_last4")
    @Setter
    private String docLast4;

    @Column(name = "holder_name")
    @Setter
    private String holderName;

    @Column(name = "holder_dob")
    @Setter
    private LocalDate holderDob;

    @Column(name = "holder_dob_year_only", nullable = false)
    @Setter
    private boolean holderDobYearOnly = false;

    @Column(name = "liveness")
    @Setter
    private String liveness;

    @Column(name = "consent_notice_version")
    @Setter
    private String consentNoticeVersion;

    @Column(name = "consent_at", nullable = false)
    @Setter
    private Instant consentAt;

    @Column(name = "submitted_at", nullable = false)
    @Setter
    private Instant submittedAt;

    @Column(name = "attempt_count", nullable = false)
    @Setter
    private int attemptCount;

    @Column(name = "attempt_window_start", nullable = false)
    @Setter
    private Instant attemptWindowStart;

    @Column(name = "reviewer_id")
    @Setter
    private UUID reviewerId;

    @Column(name = "decided_at")
    @Setter
    private Instant decidedAt;

    @Column(name = "rejection_reason")
    @Setter
    private String rejectionReason;

    @Column(name = "rejection_note")
    @Setter
    private String rejectionNote;

    @Column(name = "revoked_at")
    @Setter
    private Instant revokedAt;

    @Column(name = "revoked_by")
    @Setter
    private UUID revokedBy;

    @Column(name = "revocation_reason")
    @Setter
    private String revocationReason;

    @Column(name = "files_purged_at")
    @Setter
    private Instant filesPurgedAt;

    @Column(name = "consent_language")
    @Setter
    private String consentLanguage;

    @Column(name = "claimed_by")
    @Setter
    private UUID claimedBy;

    @Column(name = "claimed_at")
    @Setter
    private Instant claimedAt;

    @Column(name = "qa_sampled_at")
    @Setter
    private Instant qaSampledAt;

    @Column(name = "qa_reviewed_by")
    @Setter
    private UUID qaReviewedBy;

    @Column(name = "qa_reviewed_at")
    @Setter
    private Instant qaReviewedAt;

    @Column(name = "qa_outcome")
    @Setter
    private String qaOutcome;

    @Column(name = "liveness_challenge")
    @Setter
    private String livenessChallenge;

    @Column(name = "number_overridden", nullable = false)
    @Setter
    private boolean numberOverridden = false;

    protected IdentityVerification() {

    }

    public IdentityVerification(UUID userId, String docType, Instant now) {
        this.userId = userId;
        this.docType = docType;
        this.status = VerificationStatuses.PENDING;
        this.consentAt = now;
        this.submittedAt = now;
        this.attemptCount = 1;
        this.attemptWindowStart = now;
    }

    /** Clears every decision and claim field so a resubmission starts from a clean pending case. */
    public void resetForResubmission(String docType, Instant now) {
        this.docType = docType;
        this.status = VerificationStatuses.PENDING;
        this.consentAt = now;
        this.submittedAt = now;
        this.claimedNumberLast4 = null;
        this.claimedName = null;
        this.claimedDob = null;
        this.claimedHash = null;
        this.personKey = null;
        this.reviewerId = null;
        this.decidedAt = null;
        this.rejectionReason = null;
        this.rejectionNote = null;
        this.docLast4 = null;
        this.holderName = null;
        this.holderDob = null;
        this.holderDobYearOnly = false;
        this.revokedAt = null;
        this.revokedBy = null;
        this.revocationReason = null;
        this.filesPurgedAt = null;
        this.consentLanguage = null;
        this.claimedBy = null;
        this.claimedAt = null;
        this.qaSampledAt = null;
        this.qaReviewedBy = null;
        this.qaReviewedAt = null;
        this.qaOutcome = null;
        this.livenessChallenge = null;
        this.numberOverridden = false;
    }
}
