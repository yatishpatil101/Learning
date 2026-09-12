package com.draazy.api.moderation.verification;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * One document offered as proof for the <strong>Ownership Verified</strong> badge (D190/Q15, table
 * {@code property_ownership_evidence} from V63).
 *
 * <p>A row rather than another boolean on {@code properties} because the gate is three independent
 * facts and a date. "Verified?" is answerable from a boolean; "verified on the strength of what,
 * recorded by whom, and until when?" is the question ops and a disputed listing both need, and it
 * is the question a boolean has never been able to answer.
 *
 * <p>Effectively append-only: a lapsed tax receipt is superseded by recording a newer one, never by
 * editing the old row. The case file must still show what the badge was granted on at the time it
 * was granted, because that is the audit trail behind a decision a buyer relied on.
 *
 * <p>{@code propertyId}, {@code documentId} and {@code recordedBy} are plain UUIDs rather than JPA
 * associations, matching {@code Document}: this row lives in {@code moderation} and points at
 * {@code catalog}, {@code documents} and {@code identity}, and an association would drag three
 * object graphs into every read of the case file for no gain.
 */
@Entity
@Table(name = "property_ownership_evidence")
@Getter
public class OwnershipEvidence extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** One of {@link OwnershipEvidenceTypes#DOC_TYPES}; the DB holds the same list as a CHECK. */
    @Column(name = "doc_type", nullable = false, updatable = false)
    private String docType;

    /**
     * The vault row this points at, when the proof was uploaded rather than sighted in person.
     * Nullable: ops recording that they saw an original is still evidence.
     */
    @Column(name = "document_id")
    private UUID documentId;

    /**
     * When the document was issued, or the photographs taken. Supplied by the recorder, never read
     * from the clock — see {@link OwnershipEvidenceTypes} for why the review date would be wrong.
     */
    @Column(name = "issued_at", nullable = false, updatable = false)
    private Instant issuedAt;

    /**
     * Derived from {@link #docType} and {@link #issuedAt} at record time, or {@code null} for the
     * documents that never go stale. Stored rather than recomputed on read so that shortening a
     * validity window applies to future evidence instead of retroactively un-verifying every live
     * listing.
     */
    @Column(name = "expires_at", updatable = false)
    private Instant expiresAt;

    @Column(name = "recorded_by", nullable = false, updatable = false)
    private UUID recordedBy;

    /**
     * Whose identity was sighted, as the document spells it (D202, V66). Required for the identity
     * doc types and optional for the rest; the database holds the same rule as a CHECK.
     *
     * <p>Without it an {@code owner_identity} row says an identity document was seen without saying
     * whose — which cannot be checked against anything, and so cannot be wrong, and so establishes
     * nothing in the dispute that is the only occasion this table is read in anger.
     */
    @Column(name = "subject_name", updatable = false)
    private String subjectName;

    protected OwnershipEvidence() {
        // JPA
    }

    public OwnershipEvidence(UUID propertyId, String docType, UUID documentId, Instant issuedAt,
            UUID recordedBy, String subjectName) {
        this.propertyId = propertyId;
        this.docType = docType;
        this.documentId = documentId;
        this.issuedAt = issuedAt;
        this.expiresAt = OwnershipEvidenceTypes.expiryOf(docType, issuedAt);
        this.recordedBy = recordedBy;
        this.subjectName = subjectName;
    }

    /** Which of the three facts this row establishes. */
    public String kind() {
        return OwnershipEvidenceTypes.kindOf(docType);
    }

    /** Does this document still prove what it proves, as at {@code now}? */
    public boolean isCurrentAt(Instant now) {
        return expiresAt == null || expiresAt.isAfter(now);
    }
}
