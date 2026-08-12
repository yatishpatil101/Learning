package com.punenest.api.identity.auth;

import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.security.JwtProperties;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Issues and rotates refresh tokens with reuse-detection (ADR-008). Each successful refresh revokes
 * the presented token and mints a new one chained via {@code rotated_from}. If an already-revoked
 * token is presented again, that's a replay of a stolen/rotated token — the whole family for that
 * user is revoked and the caller is forced to re-authenticate.
 *
 * <p>The endpoint that calls this ({@code POST /auth/refresh}) is a later feature slice; this
 * service is the reusable machinery it will lean on.
 */
@Service
public class RefreshTokenService {

    private final RefreshTokenRepository repository;
    private final Duration ttl;

    public RefreshTokenService(RefreshTokenRepository repository, JwtProperties jwtProperties) {
        this.repository = repository;
        this.ttl = jwtProperties.refreshTtl();
    }

    /** Mint the first refresh token of a session. Returns the raw token (only its hash is stored). */
    @Transactional
    public String issue(UUID userId) {
        String raw = Tokens.randomToken();
        repository.save(new RefreshToken(userId, Tokens.sha256Hex(raw), null,
                Instant.now().plus(ttl)));
        return raw;
    }

    /**
     * Rotate a presented refresh token. Returns the owning user id + a fresh raw token, or throws
     * {@link UnauthorizedException} on invalid/expired/reused tokens.
     *
     * <p><strong>{@code noRollbackFor} the 401, or the reuse tripwire below does nothing at all.</strong>
     * The theft path revokes the whole family and <em>then</em> throws. Without this rule that
     * revocation is discarded on the way out: this advice participates in {@code AuthService.refresh}'s
     * transaction rather than owning one, so the throw marks the shared transaction rollback-only and
     * every {@code revoke()} above is dirty state that never reaches the database. The caller still
     * sees 401 — which is exactly why it looked correct — but the sibling tokens stay live for the
     * full refresh TTL, and burning them is the entire point of detecting reuse.
     *
     * <p>The rule is needed <em>here as well as</em> on {@code refresh} for the reason spelled out on
     * {@link OtpService#sendLoginCode} (D90): a participating advice that marks the transaction
     * rollback-only cannot be overruled from outside, and the outer commit would fail with
     * {@code UnexpectedRollbackException} rendered as a 500. Both ends have to agree.
     *
     * <p>Nothing needs protecting on the other two 401s — the not-found and expired paths write
     * nothing before they throw.
     */
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public Rotation rotate(String rawToken) {
        RefreshToken current = repository.findByTokenHash(Tokens.sha256Hex(rawToken))
                .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));

        if (current.isRevoked()) {
            revokeAllForUser(current.getUserId());
            throw new UnauthorizedException("Invalid refresh token");
        }
        if (current.isExpired()) {
            throw new UnauthorizedException("Invalid refresh token");
        }

        current.revoke();
        String raw = Tokens.randomToken();
        repository.save(new RefreshToken(current.getUserId(), Tokens.sha256Hex(raw),
                current.getId(), Instant.now().plus(ttl)));
        return new Rotation(current.getUserId(), raw);
    }

    /**
     * Revoke every refresh token for a user — the blunt "kill all sessions" primitive shared by
     * logout ({@code POST /auth/logout}) and the reuse-detection tripwire above.
     */
    @Transactional
    public void revokeAllForUser(UUID userId) {
        repository.findByUserId(userId).forEach(RefreshToken::revoke);
    }

    /**
     * Remove already-expired refresh tokens to keep the table bounded (D10).
     *
     * @return number of rows deleted
     */
    @Transactional
    public long pruneExpired(Instant now) {
        return repository.deleteByExpiresAtBefore(now);
    }

    /** The outcome of a rotation: whose session it is, and the new raw refresh token. */
    public record Rotation(UUID userId, String refreshToken) {
    }
}
