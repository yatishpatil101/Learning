package com.draazy.api.engagement.flatmate;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FlatmateRequestRepository extends JpaRepository<FlatmateRequest, UUID> {

    /** Re-read behind the advisory lock so duplicate asks return the contract's 409. */
    Optional<FlatmateRequest> findByKindAndTargetIdAndRequesterId(
            String kind, UUID targetId, UUID requesterId);

    List<FlatmateRequest> findByKindAndTargetId(String kind, UUID targetId);

    /** Host inbox is paged because popular ads can collect hundreds of stranger asks. */
    Page<FlatmateRequest> findByHostIdOrderByRequestedAtDesc(UUID hostId, Pageable pageable);

    Page<FlatmateRequest> findByHostIdAndStatusOrderByRequestedAtDesc(
            UUID hostId, String status, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    /** Host-scoped by id, so deciding somebody else's request is a 404 rather than a 403. */
    Optional<FlatmateRequest> findByIdAndHostId(UUID id, UUID hostId);

    /** Sort by {@code createdAt} to ride the requester's index; timestamps are set together. */
    Page<FlatmateRequest> findByRequesterIdOrderByCreatedAtDesc(UUID requesterId, Pageable pageable);

    Page<FlatmateRequest> findByRequesterIdAndStatusOrderByCreatedAtDesc(
            UUID requesterId, String status, Pageable pageable);

    @Query("""
            select new com.draazy.api.engagement.flatmate.FlatmateInterestKeyDto(r.id, r.kind, r.targetId, r.status)
            from FlatmateRequest r where r.requesterId = :requesterId
            """)
    List<FlatmateInterestKeyDto> findKeysByRequesterId(@Param("requesterId") UUID requesterId);

    /** Rate-limit interests by window because each one broadcasts a stranger's number. */
    long countByRequesterIdAndCreatedAtAfter(UUID requesterId, Instant since);

    long countByKindAndTargetIdAndStatus(String kind, UUID targetId, String status);

    @Query("""
            select count(r) from FlatmateRequest r
            where r.requesterId = :userId and r.kind = 'group' and r.status = 'pending'
              and exists (select 1 from FlatmateGroup g where g.id = r.targetId and g.archived = false)
            """)
    long countPendingGroupAsks(@Param("userId") UUID userId);

    @Modifying
    @Query("delete from FlatmateRequest r where r.id = :id and r.status = 'pending'")
    int deleteIfPending(@Param("id") UUID id);
}
