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

/**
 * One user's identity case (one row per account) — maps {@code identity_verifications} (V23). The
 * doc number never lands; UNIQUE {@code identityHash} is written from the reviewer's read at approval.
 */
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

    @Column(name = "files_purged_at")
    @Setter
    private Instant filesPurgedAt;

    protected IdentityVerification() {
        // JPA
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
        this.filesPurgedAt = null;
    }
}
