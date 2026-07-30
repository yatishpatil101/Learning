package com.punenest.api.identity.auth;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A passwordless-login OTP (ADR-008). The code is stored hashed; {@code attempts} + {@code expiresAt}
 * back throttling. Maps {@code otp_codes} (V2) — append-only, no {@code updated_at}.
 */
@Entity
@Table(name = "otp_codes")
public class OtpCode extends BaseEntity {

    /**
     * The only OTP purpose in use today. The column is scoped by purpose so future flows (e.g. a
     * transaction or contact-approval OTP) can share the table without colliding with login codes —
     * which is exactly why the lookup query filters on it rather than assuming a single kind.
     */
    public static final String PURPOSE_LOGIN = "login";

    @Column(name = "mobile", nullable = false, updatable = false)
    private String mobile;

    @Column(name = "code_hash", nullable = false, updatable = false)
    private String codeHash;

    @Column(name = "purpose", nullable = false, updatable = false)
    private String purpose = PURPOSE_LOGIN;

    @Column(name = "attempts", nullable = false)
    private int attempts = 0;

    @Column(name = "consumed", nullable = false)
    private boolean consumed = false;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    protected OtpCode() {
        // JPA
    }

    public OtpCode(String mobile, String codeHash, String purpose, Instant expiresAt) {
        this.mobile = mobile;
        this.codeHash = codeHash;
        this.purpose = purpose;
        this.expiresAt = expiresAt;
    }

    public String getMobile() {
        return mobile;
    }

    public String getCodeHash() {
        return codeHash;
    }

    public String getPurpose() {
        return purpose;
    }

    public int getAttempts() {
        return attempts;
    }

    public void recordAttempt() {
        this.attempts++;
    }

    public boolean isConsumed() {
        return consumed;
    }

    public void consume() {
        this.consumed = true;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }
}
