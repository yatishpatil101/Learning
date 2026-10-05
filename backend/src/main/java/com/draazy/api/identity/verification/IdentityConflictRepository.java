package com.draazy.api.identity.verification;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

public interface IdentityConflictRepository extends JpaRepository<IdentityConflict, UUID> {

    long countByUserIdAndCreatedAtAfter(UUID userId, Instant createdAt);

    Optional<IdentityConflict> findFirstByUserIdAndCreatedAtAfterOrderByCreatedAtDesc(
            UUID userId, Instant createdAt);

    @Modifying
    int deleteByCreatedAtBefore(Instant createdAt);

    @Modifying
    int deleteByUserId(UUID userId);
}
