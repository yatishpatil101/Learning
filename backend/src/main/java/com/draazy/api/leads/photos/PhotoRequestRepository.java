package com.draazy.api.leads.photos;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

// Finder shapes mirror the idempotency and owner-inbox indexes.
public interface PhotoRequestRepository extends JpaRepository<PhotoRequest, UUID> {

    Optional<PhotoRequest> findByRequesterIdAndPropertyId(UUID requesterId, UUID propertyId);

    // Takes property ids because photo requests do not store owner ids.
    Page<PhotoRequest> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds, Pageable pageable);
}
