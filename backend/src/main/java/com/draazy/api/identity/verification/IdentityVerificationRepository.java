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

    @Query("select v.userId from IdentityVerification v where v.userId in :userIds and v.status = :status")
    List<UUID> userIdsWithStatus(java.util.Collection<UUID> userIds, String status);

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

    @Query("""
            select count(case when v.status = 'pending' then 1 end) as pending,
                   count(case when v.status = 'pending' and v.submittedAt < :overdueBefore then 1 end) as overdue,
                   count(case when v.status = 'pending' and v.claimedBy = :me and v.claimedAt > :freshAfter then 1 end) as mine,
                   count(case when v.status = 'verified' and v.qaSampledAt is not null and v.qaReviewedAt is null
                              and (v.reviewerId is null or v.reviewerId <> :me) then 1 end) as qa,
                   count(case when v.status in ('verified', 'rejected', 'revoked') then 1 end) as decided
              from IdentityVerification v
            """)
    SummaryCounts summaryCounts(Instant overdueBefore, Instant freshAfter, UUID me);

    interface SummaryCounts {
        long getPending();

        long getOverdue();

        long getMine();

        long getQa();

        long getDecided();
    }

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
