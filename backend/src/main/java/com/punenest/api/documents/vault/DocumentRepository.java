package com.punenest.api.documents.vault;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/** Vault reads. Every one is property-scoped; there is no "all documents" query, on purpose. */
public interface DocumentRepository extends JpaRepository<Document, UUID> {

    /**
     * The vault for one listing.
     *
     * <p><strong>Service-request files are excluded, deliberately.</strong> A service request names
     * its property in the body and is raised by whoever needs the service — a tenant, a buyer, not
     * necessarily the owner — so its {@code property_id} is not proof of any relationship to that
     * listing. If these rows appeared here, anyone could push a file of their choosing into a
     * stranger's vault, and into any share granted from it, simply by quoting their property id.
     * A service request's documents are reached through the request, which is access-controlled.
     */
    List<Document> findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(UUID propertyId);

    /** The files attached to one service request — drafts, the registered copy, customer uploads. */
    List<Document> findByServiceRequestIdOrderByUploadedAtDesc(UUID serviceRequestId);

    /** The detail read for a page of requests, in one query rather than one per request. */
    List<Document> findByServiceRequestIdInOrderByUploadedAtDesc(Collection<UUID> serviceRequestIds);

    /**
     * The share read: a granted request unlocks one property's documents, filtered to the
     * categories that were actually asked for.
     *
     * <p>Matching is exact and case-insensitive rather than fuzzy. The buyer picks from the same
     * category list the owner labelled with, so a {@code like} here could only ever widen a grant —
     * "Deed" would pull in "Sale Deed" and "Mortgage Deed" alike, which is precisely the document
     * the owner did not share.
     *
     * <p>Service-request files are excluded for the same reason as the vault read above: their
     * property id is claimed by the requester, not proven, so they are not the owner's to share.
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
