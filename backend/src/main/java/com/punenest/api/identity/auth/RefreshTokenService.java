package com.punenest.api.identity.auth;

import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.security.JwtProperties;
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
    private final java.time.Duration ttl;

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
     */
    @Transactional
    public Rotation rotate(String rawToken) {
        RefreshToken current = repository.findByTokenHash(Tokens.sha256Hex(rawToken))
                .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));

        if (current.isRevoked()) {
            // Reuse of an already-rotated token ⇒ likely theft. Burn the whole family.
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
