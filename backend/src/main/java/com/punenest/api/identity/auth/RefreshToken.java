package com.punenest.api.identity.auth;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A rotating refresh token (ADR-008). Stored hashed; {@code rotatedFrom} chains rotations so a
 * replayed (already-rotated) token can be detected and the whole family revoked. Maps
 * {@code refresh_tokens} (V2) — append-only-ish (only {@code revoked} flips), no {@code updated_at}.
 *
 * <p>{@code userId}/{@code rotatedFrom} are held as raw UUIDs rather than {@code @ManyToOne}
 * associations — this table is only ever queried by its own hash/id, so an association would add
 * lazy-loading machinery for no gain (ponytail: keep the mapping flat).
 */
@Entity
@Table(name = "refresh_tokens")
public class RefreshToken extends BaseEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true, updatable = false)
    private String tokenHash;

    @Column(name = "rotated_from", updatable = false)
    private UUID rotatedFrom;

    @Column(name = "revoked", nullable = false)
    private boolean revoked = false;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    protected RefreshToken() {
        // JPA
    }

    public RefreshToken(UUID userId, String tokenHash, UUID rotatedFrom, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.rotatedFrom = rotatedFrom;
        this.expiresAt = expiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public UUID getRotatedFrom() {
        return rotatedFrom;
    }

    public boolean isRevoked() {
        return revoked;
    }

    public void revoke() {
        this.revoked = true;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }
}
