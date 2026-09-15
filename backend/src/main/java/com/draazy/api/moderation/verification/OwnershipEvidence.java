package com.draazy.api.moderation.verification;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

/**
 * One document offered as proof for the <strong>Ownership Verified</strong> badge (table
 * {@code property_ownership_evidence}). Effectively append-only: it is the case file.
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
     * When the document was issued, supplied by the recorder and never read from the clock. Stored
     * as an instant but anchored to {@link PlatformTime#IST}, so every client gets the same day edge.
     */
    @Column(name = "issued_at", nullable = false, updatable = false)
    private Instant issuedAt;

    /**
     * Derived at record time, or {@code null} for documents that never go stale. Stored rather than
     * recomputed so shortening a validity window cannot retroactively un-verify live listings.
     */
    @Column(name = "expires_at", updatable = false)
    private Instant expiresAt;

    @Column(name = "recorded_by", nullable = false, updatable = false)
    private UUID recordedBy;

    /**
     * Whose identity was sighted, as the document spells it. Required for the identity doc types —
     * a row that does not say whose cannot be checked, and so establishes nothing in a dispute.
     */
    @Column(name = "subject_name", updatable = false)
    private String subjectName;

    protected OwnershipEvidence() {
        // JPA
    }

    public OwnershipEvidence(UUID propertyId, String docType, UUID documentId, LocalDate issuedOn,
            UUID recordedBy, String subjectName) {
        this.propertyId = propertyId;
        this.docType = docType;
        this.documentId = documentId;
        this.issuedAt = issuedOn.atStartOfDay(PlatformTime.IST).toInstant();
        this.expiresAt = OwnershipEvidenceTypes.expiryOf(docType, this.issuedAt);
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
