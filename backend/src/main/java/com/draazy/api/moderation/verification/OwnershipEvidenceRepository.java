package com.draazy.api.moderation.verification;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Evidence rows for the ownership gate. Reads of the table are all "the evidence for one listing",
 * newest issue date first, because a superseding document answers "is this still current?".
 */
public interface OwnershipEvidenceRepository extends JpaRepository<OwnershipEvidence, UUID> {

    List<OwnershipEvidence> findByPropertyIdOrderByIssuedAtDesc(UUID propertyId);

    /**
     * The one read that starts from a document: the vault is about to delete a file and needs to know
     * whether a badge rests on it. {@code findFirst} because only the listing can turn the answer.
     */
    Optional<OwnershipEvidence> findFirstByDocumentId(UUID documentId);
}
