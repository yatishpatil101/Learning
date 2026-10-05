package com.draazy.api.identity.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Second factor and guess throttle for one back-office account (V87). */
@Entity
@Table(name = "staff_credentials")
@Getter
public class StaffCredential {

    static final int MAX_FAILED_ATTEMPTS = 5;
    static final Duration LOCKOUT = Duration.ofMinutes(15);

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "totp_secret")
    private String totpSecret;

    @Column(name = "totp_confirmed_at")
    private Instant totpConfirmedAt;

    @Column(name = "totp_last_step")
    private Long totpLastStep;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recovery_code_hashes", nullable = false)
    private List<String> recoveryCodeHashes = new ArrayList<>();

    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected StaffCredential() {
        // JPA
    }

    public boolean isEnrolled() {
        return totpConfirmedAt != null;
    }

    public boolean isLocked(Instant now) {
        return lockedUntil != null && now.isBefore(lockedUntil);
    }

    /** The fifth consecutive miss locks the account and restarts the count for after the lock. */
    public void recordFailure(Instant now) {
        failedAttempts++;
        if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
            failedAttempts = 0;
            lockedUntil = now.plus(LOCKOUT);
        }
    }

    public void recordSuccess() {
        failedAttempts = 0;
        lockedUntil = null;
    }

    /** A fresh, unconfirmed secret; replaces any earlier unconfirmed one. */
    public void startEnrolment(String encryptedSecret) {
        if (isEnrolled()) {
            throw new IllegalStateException("already enrolled: " + userId);
        }
        this.totpSecret = encryptedSecret;
    }

    public void confirmEnrolment(long step, List<String> recoveryHashes, Instant now) {
        this.totpConfirmedAt = now;
        this.totpLastStep = step;
        this.recoveryCodeHashes = new ArrayList<>(recoveryHashes);
    }

    /** Codes are single use: a step at or before the last accepted one is a replay. */
    public boolean acceptStep(long step) {
        if (totpLastStep != null && step <= totpLastStep) {
            return false;
        }
        totpLastStep = step;
        return true;
    }

    public boolean consumeRecoveryCode(String hash) {
        String match = recoveryCodeHashes.stream().filter(h -> Tokens.hashesEqual(h, hash)).findFirst()
                .orElse(null);
        if (match == null) {
            return false;
        }
        List<String> remaining = new ArrayList<>(recoveryCodeHashes);
        remaining.remove(match);
        recoveryCodeHashes = remaining;
        return true;
    }

    /** Administrator reset after a lost phone: the next sign-in enrols again. */
    public void resetSecondFactor() {
        totpSecret = null;
        totpConfirmedAt = null;
        totpLastStep = null;
        recoveryCodeHashes = new ArrayList<>();
        recordSuccess();
    }
}
