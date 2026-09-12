package com.draazy.api.documents.vault;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Managed-record vault reads. Every one is scoped to a single {@code managed_properties} row, and
 * that row's ownership is resolved before this repository is touched — there is no owner column
 * here to filter on, and no "all managed documents" query, on purpose.
 */
public interface ManagedPropertyDocumentRepository
        extends JpaRepository<ManagedPropertyDocument, UUID> {

    /**
     * One managed record's papers, newest first. The {@code id} tiebreaker keeps the order
     * deterministic when two uploads share a clock tick — {@code uploaded_at} alone would leave
     * their relative order to chance, which a "newest first" contract cannot afford.
     */
    List<ManagedPropertyDocument> findByManagedPropertyIdOrderByUploadedAtDescIdDesc(
            UUID managedPropertyId);
}
