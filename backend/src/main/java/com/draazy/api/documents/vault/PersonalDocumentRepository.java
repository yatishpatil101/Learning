package com.draazy.api.documents.vault;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Owner-scoped reads only, with no all-documents query: a KYC document is read solely by its owner. */
public interface PersonalDocumentRepository extends JpaRepository<PersonalDocument, UUID> {

    /** The {@code id} tiebreaker keeps newest-first deterministic when two uploads share a clock tick. */
    List<PersonalDocument> findByOwnerIdOrderByUploadedAtDescIdDesc(UUID ownerId);

    /** Both key halves are required: {@code existsById} alone would confirm that somebody's document exists, which
     * is the enumeration answer owner-scoping withholds. */
    boolean existsByIdAndOwnerId(UUID id, UUID ownerId);

    boolean existsByStorageKey(String storageKey);

    /** Both key halves again: this row carries {@code storageKey}, so an id-only variant would be a signing
     * oracle; package-private so only {@link PersonalDocumentProofs} calls it, and it hands out a signed URL. */
    Optional<PersonalDocument> findByIdAndOwnerId(UUID id, UUID ownerId);
}
