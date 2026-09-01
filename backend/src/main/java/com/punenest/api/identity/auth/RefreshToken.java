package com.punenest.api.identity.auth;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

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
@Getter
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

    /**
     * How many <em>consecutive</em> graced replays this chain has been forgiven, ending at this row
     * (V126). Carried forward by every rotation, reset to zero by an uncontested one, and checked by
     * {@link RefreshTokenService#rotate} so forgiveness is bounded per family rather than per event.
     *
     * <p>It lives on the token rather than on the user because it describes one chain: a second
     * device racing on its own family says nothing about this one, and burning both would punish a
     * session that never misbehaved.
     */
    @Column(name = "graced_count", nullable = false, updatable = false)
    private int gracedCount = 0;

    protected RefreshToken() {
        // JPA
    }

    public RefreshToken(UUID userId, String tokenHash, UUID rotatedFrom, Instant expiresAt) {
        this(userId, tokenHash, rotatedFrom, expiresAt, 0);
    }

    public RefreshToken(UUID userId, String tokenHash, UUID rotatedFrom, Instant expiresAt,
            int gracedCount) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.rotatedFrom = rotatedFrom;
        this.expiresAt = expiresAt;
        this.gracedCount = gracedCount;
    }

    public void revoke() {
        this.revoked = true;
    }

    public boolean isExpired() {
        return Instant.now().isAfter(expiresAt);
    }
}
