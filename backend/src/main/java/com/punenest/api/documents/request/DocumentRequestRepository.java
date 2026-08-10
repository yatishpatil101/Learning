package com.punenest.api.documents.request;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentRequestRepository extends JpaRepository<DocumentRequest, UUID> {

    /**
     * The owner's inbox, scoped to listings they actually own. Newest first, paged (D77).
     *
     * <p>Rides V49's {@code idx_document_requests_property_created}: with the sort column in the
     * index, Postgres merges the per-property scans already in {@code created_at} order and stops
     * after one page, instead of collecting every request against the owner's whole portfolio and
     * sorting it to throw all but twenty rows away.
     */
    Page<DocumentRequest> findByPropertyIdInOrderByCreatedAtDesc(
            Collection<UUID> propertyIds, Pageable pageable);

    /** The idempotency read behind {@code POST /documents/requests}. */
    Optional<DocumentRequest> findByRequesterIdAndPropertyIdAndStatus(
            UUID requesterId, UUID propertyId, String status);

    /**
     * The share lookup. Returns the row for any status; the caller decides what a non-granted or
     * lapsed row means, so that the answer for "wrong token", "declined" and "expired" can be made
     * identical — see {@link DocumentRequestService#shared}.
     */
    Optional<DocumentRequest> findByShareToken(String shareToken);
}
