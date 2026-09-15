package com.draazy.api.identity.verification;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface IdentityVerificationRepository extends JpaRepository<IdentityVerification, UUID> {

    Optional<IdentityVerification> findByUserId(UUID userId);

    /**
     * Submit path: the row is the attempt counter, so two concurrent submits from one device must
     * serialise on it or the 3-per-day cap becomes 6.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from IdentityVerification v where v.userId = :userId")
    Optional<IdentityVerification> findByUserIdForUpdate(UUID userId);

    /**
     * Decision path: two reviewers opening the same case must serialise, or both pass the pending
     * check and the applicant is notified twice with only the later reviewer recorded.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from IdentityVerification v where v.id = :id")
    Optional<IdentityVerification> findByIdForUpdate(UUID id);

    /** Backed by the UNIQUE index; lets approve return 409 rather than a constraint violation. */
    Optional<IdentityVerification> findByIdentityHash(String identityHash);

    List<IdentityVerification> findByClaimedHash(String claimedHash);

    List<IdentityVerification> findByPersonKey(String personKey);

    Page<IdentityVerification> findByStatusOrderBySubmittedAtAsc(String status, Pageable pageable);

    Page<IdentityVerification> findAllByOrderBySubmittedAtDesc(Pageable pageable);

    @Query("select v from IdentityVerification v where v.decidedAt < :cutoff and v.filesPurgedAt is null")
    List<IdentityVerification> findPurgeCandidates(Instant cutoff, Pageable pageable);
}
