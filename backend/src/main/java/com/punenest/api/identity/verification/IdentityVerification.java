package com.punenest.api.identity.verification;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * The identity (KYC) verification badge (ADR-009/009b/019). Merges the in-progress KycStart handle
 * with the DigiLocker result. Raw Aadhaar is never stored (only last-4 masked); {@code identityHash}
 * is a server-computed dedup key enforcing "one Aadhaar = one account". Maps
 * {@code identity_verifications} (V2).
 */
@Entity
@Table(name = "identity_verifications")
@Getter
public class IdentityVerification extends AuditedEntity {

    @Column(name = "user_id", nullable = false, unique = true, updatable = false)
    private UUID userId;

    @Column(name = "ref", unique = true)
    @Setter
    private String ref;

    @Column(name = "badge", nullable = false)
    @Setter
    private boolean badge = false;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = "none";

    @Column(name = "source")
    @Setter
    private String source;

    @Column(name = "masked_aadhaar")
    @Setter
    private String maskedAadhaar;

    @Column(name = "identity_hash", unique = true)
    @Setter
    private String identityHash;

    /** Soft signal (ADR-009a): whether the KYC mobile matched the account mobile. Nullable. */
    @Column(name = "mobile_match")
    @Setter
    private Boolean mobileMatch;

    @Column(name = "verification_url")
    @Setter
    private String verificationUrl;

    @Column(name = "expires_at")
    @Setter
    private Instant expiresAt;

    @Column(name = "verified_at")
    @Setter
    private Instant verifiedAt;

    protected IdentityVerification() {
        // JPA
    }

    public IdentityVerification(UUID userId) {
        this.userId = userId;
    }

}
