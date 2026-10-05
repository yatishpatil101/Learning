package com.draazy.api.identity.verification;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface IdentityVerificationRepository extends JpaRepository<IdentityVerification, UUID>,
        JpaSpecificationExecutor<IdentityVerification> {

    Optional<IdentityVerification> findByUserId(UUID userId);

    // The row is the attempt counter; concurrent submits must serialise on it.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from IdentityVerification v where v.userId = :userId")
    Optional<IdentityVerification> findByUserIdForUpdate(UUID userId);

    // Serialises two reviewers so only one pending decision can pass.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from IdentityVerification v where v.id = :id")
    Optional<IdentityVerification> findByIdForUpdate(UUID id);

    /** Backed by the UNIQUE index; lets approve return 409 rather than a constraint violation. */
    Optional<IdentityVerification> findByIdentityHash(String identityHash);

    List<IdentityVerification> findByClaimedHash(String claimedHash);

    List<IdentityVerification> findByPersonKey(String personKey);

    long countByClaimedByAndStatusAndClaimedAtAfter(UUID claimedBy, String status, Instant cutoff);

    @Query("select v from IdentityVerification v where v.decidedAt < :cutoff and v.filesPurgedAt is null")
    List<IdentityVerification> findPurgeCandidates(Instant cutoff, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select v from IdentityVerification v
             where v.status = 'pending'
               and v.submittedAt < :cutoff
               and (v.claimedBy is null or v.claimedAt <= :claimCutoff)
            """)
    List<IdentityVerification> findStalePendingForUpdate(Instant cutoff, Instant claimCutoff, Pageable pageable);
}
