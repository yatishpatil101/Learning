package com.draazy.api.identity.auth;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.Getter;

/**
 * A passwordless-login OTP (ADR-008). The code is stored hashed; {@code attempts} + {@code expiresAt}
 * back throttling. Maps {@code otp_codes} (V2) — append-only, no {@code updated_at}.
 *
 * <p>No {@code @Setter}: every field is either constructor-set or changed only through a named
 * behaviour method ({@link #recordAttempt()}, {@link #consume()}). A setter would let a caller
 * decrement the attempt count or un-consume a code, which is the throttle this class exists to be.
 */
@Entity
@Table(name = "otp_codes")
@Getter
public class OtpCode extends BaseEntity {

    /**
     * The only OTP purpose in use today. The column is scoped by purpose so future flows (e.g. a
     * transaction or contact-approval OTP) can share the table without colliding with login codes —
     * which is exactly why the lookup query filters on it rather than assuming a single kind.
     */
    public static final String PURPOSE_LOGIN = "login";

    /**
     * A flat owner confirming they know their tenant is seeking a replacement flatmate (V29).
     *
     * <p>Deliberately not {@link #PURPOSE_LOGIN}: this code authenticates nobody, issues no token,
     * and is sent to a person who usually has no account. Sharing the login purpose would have made
     * the consent form a way to mint login codes for any number a caller can name.
     */
    public static final String PURPOSE_OWNER_CONSENT = "owner-consent";

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

    public void recordAttempt() {
        this.attempts++;
    }

    public void consume() {
        this.consumed = true;
    }

    /**
     * Not a property — there is no {@code expired} field, so Lombok generates nothing that collides
     * with this name and it stays free for the computed answer.
     */
    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }
}
