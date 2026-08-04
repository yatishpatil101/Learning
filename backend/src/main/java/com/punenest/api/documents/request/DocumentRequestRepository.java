package com.punenest.api.documents.request;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DocumentRequestRepository extends JpaRepository<DocumentRequest, UUID> {

    /** The owner's inbox, scoped to listings they actually own. Newest first. */
    List<DocumentRequest> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds);

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
