package com.draazy.api.identity.verification;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "identity_conflicts")
public class IdentityConflict extends BaseEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "doc_type", nullable = false, updatable = false)
    private String docType;

    @Column(name = "claimed_hash", nullable = false, updatable = false)
    private String claimedHash;

    @Column(name = "holder_verification_id", updatable = false)
    private UUID holderVerificationId;

    protected IdentityConflict() {
    }

    public IdentityConflict(UUID userId, String docType, String claimedHash, UUID holderVerificationId) {
        this.userId = userId;
        this.docType = docType;
        this.claimedHash = claimedHash;
        this.holderVerificationId = holderVerificationId;
    }

    public String getDocType() {
        return docType;
    }

    public UUID getHolderVerificationId() {
        return holderVerificationId;
    }
}
