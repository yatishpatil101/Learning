package com.punenest.api.identity.verification;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * The identity (KYC) verification badge (ADR-009/009b/019). Merges the in-progress KycStart handle
 * with the DigiLocker result. Raw Aadhaar is never stored (only last-4 masked); {@code identityHash}
 * is a server-computed dedup key enforcing "one Aadhaar = one account". Maps
 * {@code identity_verifications} (V2).
 */
@Entity
@Table(name = "identity_verifications")
public class IdentityVerification extends AuditedEntity {

    @Column(name = "user_id", nullable = false, unique = true, updatable = false)
    private UUID userId;

    @Column(name = "ref", unique = true)
    private String ref;

    @Column(name = "badge", nullable = false)
    private boolean badge = false;

    @Column(name = "status", nullable = false)
    private String status = "none";

    @Column(name = "source")
    private String source;

    @Column(name = "masked_aadhaar")
    private String maskedAadhaar;

    @Column(name = "identity_hash", unique = true)
    private String identityHash;

    /** Soft signal (ADR-009a): whether the KYC mobile matched the account mobile. Nullable. */
    @Column(name = "mobile_match")
    private Boolean mobileMatch;

    @Column(name = "verification_url")
    private String verificationUrl;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "verified_at")
    private Instant verifiedAt;

    protected IdentityVerification() {
        // JPA
    }

    public IdentityVerification(UUID userId) {
        this.userId = userId;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getRef() {
        return ref;
    }

    public void setRef(String ref) {
        this.ref = ref;
    }

    public boolean isBadge() {
        return badge;
    }

    public void setBadge(boolean badge) {
        this.badge = badge;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public String getMaskedAadhaar() {
        return maskedAadhaar;
    }

    public void setMaskedAadhaar(String maskedAadhaar) {
        this.maskedAadhaar = maskedAadhaar;
    }

    public String getIdentityHash() {
        return identityHash;
    }

    public void setIdentityHash(String identityHash) {
        this.identityHash = identityHash;
    }

    public Boolean getMobileMatch() {
        return mobileMatch;
    }

    public void setMobileMatch(Boolean mobileMatch) {
        this.mobileMatch = mobileMatch;
    }

    public String getVerificationUrl() {
        return verificationUrl;
    }

    public void setVerificationUrl(String verificationUrl) {
        this.verificationUrl = verificationUrl;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public Instant getVerifiedAt() {
        return verifiedAt;
    }

    public void setVerifiedAt(Instant verifiedAt) {
        this.verifiedAt = verifiedAt;
    }
}
