package com.punenest.api.documents.vault;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Personal-vault reads. Every one is owner-scoped; there is no "all personal documents" query, on
 * purpose — a KYC document is only ever read by the person it belongs to.
 */
public interface PersonalDocumentRepository extends JpaRepository<PersonalDocument, UUID> {

    /**
     * One person's papers, newest first. The {@code id} tiebreaker keeps the order deterministic
     * when two uploads share a clock tick — {@code uploaded_at} alone would leave their relative
     * order to chance, which a "newest first" contract cannot afford.
     */
    List<PersonalDocument> findByOwnerIdOrderByUploadedAtDescIdDesc(UUID ownerId);
}
