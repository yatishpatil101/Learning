package com.draazy.api.documents.vault;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/** Vault reads. Every one is property-scoped; there is no "all documents" query, on purpose. */
public interface DocumentRepository extends JpaRepository<Document, UUID> {

  boolean existsByPropertyIdAndServiceRequestIdIsNull(UUID propertyId);

    /**
     * Vault for one listing; service-request files excluded (their {@code property_id} is claimed
     * by the requester, not proven, so including them would let anyone push files into a stranger's vault).
     */
    List<Document> findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(UUID propertyId);

    /**
     * One batch for a page of document-access requests. The service groups these rows by property
     * and applies each request's category scope in memory, avoiding one count query per inbox row.
     */
    List<Document> findByPropertyIdInAndServiceRequestIdIsNull(Collection<UUID> propertyIds);

    /** The files attached to one service request — drafts, the registered copy, customer uploads. */
    List<Document> findByServiceRequestIdOrderByUploadedAtDesc(UUID serviceRequestId);

    /** The detail read for a page of requests, in one query rather than one per request. */
    List<Document> findByServiceRequestIdInOrderByUploadedAtDesc(Collection<UUID> serviceRequestIds);

    /**
     * Share read: one property's documents filtered by requested categories; exact case-insensitive
     * match ({@code like} would widen a grant), service-request files excluded as in the vault read.
     */
    @Query("""
            select d from Document d
            where d.propertyId = :propertyId
              and d.serviceRequestId is null
              and lower(d.category) in :categories
            order by d.uploadedAt desc
            """)
    List<Document> findSharable(UUID propertyId, Collection<String> categories);
}
