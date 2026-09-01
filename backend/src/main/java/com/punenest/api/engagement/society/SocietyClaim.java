package com.punenest.api.engagement.society;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * A committee asking to administer its own society page (V101 {@code society_claims}).
 *
 * <p><strong>Why a claim is a row and not a flag on the society.</strong> {@code
 * societies.claim_status} is the answer; this is the request that produced it, and the two are not
 * the same thing. The status alone cannot say who asked, what they said their role was, who decided
 * or when — and every one of those is what somebody looks up when a second secretary calls to say
 * the page is being run by the wrong person. It also cannot carry a rejection, so a society whose
 * paperwork was refused would be indistinguishable from one nobody had ever asked about.
 *
 * <p><strong>The approved claimant is the society admin.</strong> There is no separate
 * "committee members" table and deliberately so: administering the page is exactly the authority
 * this row grants, so storing it twice would create two answers to one question. {@link
 * SocietyMembershipService} reads the approved claim to decide whether a caller may review
 * residents.
 */
@Entity
@Table(name = "society_claims")
@Getter
public class SocietyClaim extends AuditedEntity {

    @Column(name = "society_id", nullable = false, updatable = false)
    private UUID societyId;

    /** The user who asked. Becomes the society admin if the claim is approved. */
    @Column(name = "claimed_by", nullable = false, updatable = false)
    private UUID claimedBy;

    /** As given on the form — a committee's contact name, which need not be the account's name. */
    @Column(name = "name", nullable = false)
    private String name;

    /** Free text: "Secretary", "Chairman", "Managing Committee". Not an enum — see the request DTO. */
    @Column(name = "role")
    private String role;

    @Column(name = "email")
    private String email;

    /** What the claimant told us, and later what ops recorded when deciding. */
    @Column(name = "note")
    private String note;

    /**
     * The society's registration number as the claimant gave it (V109). Unvalidated by design — the
     * Maharashtra format varies by registrar, so the operator comparing it against the certificate
     * is the only validator this can have.
     */
    @Column(name = "registration_no")
    private String registrationNo;

    /**
     * The claimant's personal-vault row holding the scanned certificate, or null when they had none
     * to hand (V109). A plain UUID rather than a JPA association: the vault is another bounded
     * context, so this end of the reference is a pointer the service checks, not a mapped entity.
     */
    @Column(name = "certificate_document_id")
    private UUID certificateDocumentId;

    @Column(name = "status", nullable = false)
    private String status = SocietyClaimStatuses.PENDING;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decided_by")
    private UUID decidedBy;

    protected SocietyClaim() {
    }

    SocietyClaim(UUID societyId, UUID claimedBy, String name, String role, String email,
            String note, String registrationNo, UUID certificateDocumentId) {
        this.societyId = societyId;
        this.claimedBy = claimedBy;
        this.name = name;
        this.role = role;
        this.email = email;
        this.note = note;
        this.registrationNo = registrationNo;
        this.certificateDocumentId = certificateDocumentId;
    }

    /**
     * Re-submitting one's own pending claim updates it rather than queueing a second.
     *
     * <p>Every field is replaced, including with nothing. A correction is the whole form again, so a
     * claimant who removes the certificate they attached by mistake has to be able to leave it off —
     * merging only the non-null values would make an attachment impossible to take back.
     */
    void amend(String nextName, String nextRole, String nextEmail, String nextNote,
            String nextRegistrationNo, UUID nextCertificateDocumentId) {
        this.name = nextName;
        this.role = nextRole;
        this.email = nextEmail;
        this.note = nextNote;
        this.registrationNo = nextRegistrationNo;
        this.certificateDocumentId = nextCertificateDocumentId;
    }

    void decide(String nextStatus, UUID by, String opsNote) {
        this.status = nextStatus;
        this.decidedAt = Instant.now();
        this.decidedBy = by;
        if (opsNote != null && !opsNote.isBlank()) {
            this.note = opsNote;
        }
    }

    public boolean isApproved() {
        return SocietyClaimStatuses.APPROVED.equals(status);
    }
}
