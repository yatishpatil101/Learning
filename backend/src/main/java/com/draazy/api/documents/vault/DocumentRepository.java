package com.draazy.api.documents.vault;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface DocumentRepository extends JpaRepository<Document, UUID> {

  boolean existsByPropertyIdAndServiceRequestIdIsNull(UUID propertyId);

    boolean existsByStorageKey(String storageKey);

    List<Document> findByPropertyIdAndServiceRequestIdIsNullOrderByUploadedAtDesc(UUID propertyId);

    // Group in memory to avoid one count query per inbox row.
    List<Document> findByPropertyIdInAndServiceRequestIdIsNull(Collection<UUID> propertyIds);

    List<Document> findByServiceRequestIdOrderByUploadedAtDesc(UUID serviceRequestId);

    long countByServiceRequestIdAndCategory(UUID serviceRequestId, String category);

    List<Document> findByServiceRequestIdInOrderByUploadedAtDesc(Collection<UUID> serviceRequestIds);

    @Query("""
            select count(d) > 0
            from Document d, Property p
            where d.id = :id
              and d.propertyId = p.id
              and p.owner.id = :ownerId
              and d.serviceRequestId is null
            """)
    boolean existsOwnedPropertyVaultDocument(UUID id, UUID ownerId);

    @Query("""
            select d from Document d
            where d.propertyId = :propertyId
              and d.serviceRequestId is null
              and lower(d.category) in :categories
            order by d.uploadedAt desc
            """)
    List<Document> findSharable(UUID propertyId, Collection<String> categories);
}
