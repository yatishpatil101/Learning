package com.draazy.api.leads.contact;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

// Finder shapes mirror the contact-request indexes, so inbox and reveal checks stay cheap.
public interface ContactRequestRepository extends JpaRepository<ContactRequest, UUID> {

    Optional<ContactRequest> findByRequesterIdAndPropertyId(UUID requesterId, UUID propertyId);

    // This count is the tally, and that is what makes the quota race-proof.
    long countByRequesterId(UUID requesterId);

    // The mapper asks this on every detail render, so an existence check is enough.
    boolean existsByRequesterIdAndPropertyIdAndStatus(UUID requesterId, UUID propertyId, String status);

    @Query("""
            select cr.propertyId, cr.requesterId from ContactRequest cr
            where cr.propertyId in :propertyIds
              and cr.requesterId in :requesterIds
              and cr.status = :status
            """)
    List<Object[]> approvedRequestersForProperties(
            @Param("propertyIds") Collection<UUID> propertyIds,
            @Param("requesterIds") Collection<UUID> requesterIds,
                                   @Param("status") String status);

    @Query("""
            select cr.propertyId from ContactRequest cr
            where cr.requesterId = :requesterId
              and cr.propertyId in :propertyIds
              and cr.status = :status
            """)
    List<UUID> approvedPropertyIdsForRequester(
            @Param("requesterId") UUID requesterId,
            @Param("propertyIds") Collection<UUID> propertyIds,
                                   @Param("status") String status);

    @Query("""
            select cr.propertyId, count(cr) from ContactRequest cr
            where cr.propertyId in :propertyIds
              and cr.status = :status
              and cr.createdAt >= :liveSince
            group by cr.propertyId
            """)
    List<Object[]> countPendingByProperty(
            @Param("propertyIds") Collection<UUID> propertyIds,
            @Param("status") String status,
            @Param("liveSince") Instant liveSince);

    // Takes property ids because contact requests do not store owner ids.
    Page<ContactRequest> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds,
            Pageable pageable);

    Page<ContactRequest> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<ContactRequest> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    // This table owns the question, so the finance slice should not query it.
    @Query("""
            update ContactRequest cr
               set cr.status = :toStatus
             where cr.id = :id
               and cr.status = :fromStatus
            """)
    int updateStatusIfCurrent(@Param("id") UUID id,
                              @Param("fromStatus") String fromStatus,
                              @Param("toStatus") String toStatus);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update ContactRequest cr
               set cr.createdAt = :now, cr.message = :message
             where cr.id = :id
               and cr.status = 'pending'
            """)
    int renewIfPending(@Param("id") UUID id, @Param("message") String message,
                       @Param("now") Instant now);

    @Query("""
            select count(cr) > 0 from ContactRequest cr
            where cr.requesterId = :requesterId
              and cr.status = :status
              and cr.propertyId in (select p.id from Property p where p.owner.id = :ownerId)
            """)
    boolean existsApprovedForOwner(@Param("requesterId") UUID requesterId,
                                   @Param("ownerId") UUID ownerId,
                                   @Param("status") String status);
}
