package com.draazy.api.documents.vault;

import java.util.List;
import java.util.Optional;
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

    /**
     * Owner-scoped existence, for another context holding a reference it was handed rather than one
     * it read. Both halves of the key are required together: {@code existsById} alone would confirm
     * that somebody's document exists, which is the enumeration answer this repository's
     * owner-scoping rule exists to withhold.
     */
    boolean existsByIdAndOwnerId(UUID id, UUID ownerId);

    /**
     * The same owner-scoped lookup, returning the row for the one caller that has to show the file
     * rather than merely trust a pointer to it.
     *
     * <p>Both halves of the key again, and for a sharper reason than above: this result carries the
     * {@code storageKey}, so an id-only variant would be a signing oracle for every KYC document in
     * the vault. It stays package-private to {@code documents.vault} — {@link PersonalDocumentProofs}
     * is the only caller, and it hands out a signed URL, never the key.
     */
    Optional<PersonalDocument> findByIdAndOwnerId(UUID id, UUID ownerId);
}
