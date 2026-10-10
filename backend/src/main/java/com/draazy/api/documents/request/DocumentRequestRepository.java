package com.draazy.api.documents.request;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DocumentRequestRepository extends JpaRepository<DocumentRequest, UUID> {

    // Rides the migration `idx_document_requests_property_created`: with the sort column in the index.
    Page<DocumentRequest> findByPropertyIdInOrderByCreatedAtDesc(
            Collection<UUID> propertyIds, Pageable pageable);

    Page<DocumentRequest> findByRequesterIdOrderByCreatedAtDesc(UUID requesterId, Pageable pageable);

    Page<DocumentRequest> findByRequesterIdAndPropertyIdOrderByCreatedAtDesc(
            UUID requesterId, UUID propertyId, Pageable pageable);

    /** The idempotency read behind {@code POST /documents/requests}. */
    Optional<DocumentRequest> findByRequesterIdAndPropertyIdAndStatus(
            UUID requesterId, UUID propertyId, String status);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            update DocumentRequest dr
               set dr.status = :toStatus,
                   dr.shareToken = :shareToken,
                   dr.expiresAt = :expiresAt
             where dr.id = :id
               and dr.status = :fromStatus
            """)
    int updateDecisionIfCurrent(@Param("id") UUID id,
                                @Param("fromStatus") String fromStatus,
                                @Param("toStatus") String toStatus,
                                @Param("shareToken") String shareToken,
                                @Param("expiresAt") java.time.Instant expiresAt);

    Optional<DocumentRequest> findByShareToken(String shareToken);
}
