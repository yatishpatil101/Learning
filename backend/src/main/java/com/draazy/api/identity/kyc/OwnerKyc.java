package com.draazy.api.identity.kyc;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * An owner's KYC record. Maps {@code owner_kyc} (V6).
 *
 * <p><strong>Natural key, no surrogate id</strong> — the same reasoning as
 * {@code finance.ledger.OwnershipBasis}: V6 makes {@code user_id} the primary key because a user
 * has exactly one KYC record, and a surrogate id would permit two, which is precisely the
 * ambiguity ("which one is current?") the natural key rules out. The contract agrees: {@code
 * GET/PUT /me/owner-kyc} is singular and carries no id.
 *
 * <p><strong>Masked columns only.</strong> There is deliberately no {@code pan} or {@code aadhaar}
 * field to set — see {@link KycMasks}.
 */
@Entity
@Table(name = "owner_kyc")
@Getter
public class OwnerKyc {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "pan_masked")
    private String panMasked;

    @Column(name = "aadhaar_masked")
    private String aadhaarMasked;

    /** Set by the payments/KYC provider on bank-account verification, never by the client. */
    @Column(name = "bank_verified", nullable = false)
    private boolean bankVerified;

    /** One of {@link OwnerKycStatuses}; the V6 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    private String status = OwnerKycStatuses.PENDING;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected OwnerKyc() {
        // JPA
    }

    public OwnerKyc(UUID userId) {
        this.userId = userId;
    }

    /**
     * Record what the owner submitted, as masks.
     *
     * <p>Resubmitting resets {@link #status} to {@code pending}: a verified verdict belongs to the
     * identifiers it was issued against, so changing them and keeping the badge would let anyone
     * verify once with their own PAN and then swap in somebody else's.
     */
    public void submit(String panMasked, String aadhaarMasked) {
        this.panMasked = panMasked;
        this.aadhaarMasked = aadhaarMasked;
        this.status = OwnerKycStatuses.PENDING;
    }

}
