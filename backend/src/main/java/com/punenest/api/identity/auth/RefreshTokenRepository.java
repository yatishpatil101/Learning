package com.punenest.api.identity.auth;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    /**
     * Look up a token by its hash for rotation, taking a {@code PESSIMISTIC_WRITE} (SELECT … FOR
     * UPDATE) row lock. This closes a concurrent-rotation replay window: without the lock, two
     * simultaneous {@code /auth/refresh} calls presenting the same token both read {@code revoked=false}
     * under READ COMMITTED and each mint a fresh token from one presentation. The lock serializes them
     * so the second caller observes the just-revoked row and trips reuse-detection (ADR-008). Only
     * called from {@link RefreshTokenService#rotate}, which runs in a transaction, so the lock is scoped
     * to that path and never penalizes other reads.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    List<RefreshToken> findByUserId(UUID userId);
}
