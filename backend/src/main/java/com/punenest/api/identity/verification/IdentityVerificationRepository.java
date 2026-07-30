package com.punenest.api.identity.verification;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface IdentityVerificationRepository extends JpaRepository<IdentityVerification, UUID> {

    Optional<IdentityVerification> findByUserId(UUID userId);

    Optional<IdentityVerification> findByRef(String ref);

    /**
     * Dedup lookup for "one Aadhaar = one account" (ADR-009b). Backed by the {@code identity_hash}
     * UNIQUE index, so this is an index probe; the unique constraint remains the real guarantee and
     * this read only lets us fail the webhook gracefully instead of on a constraint violation.
     */
    Optional<IdentityVerification> findByIdentityHash(String identityHash);
}
