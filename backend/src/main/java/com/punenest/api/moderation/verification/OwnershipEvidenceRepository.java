package com.punenest.api.moderation.verification;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Evidence rows for the ownership gate (D190).
 *
 * <p>Only one query, and deliberately so: every read of this table is "the evidence for one
 * listing" — the ops case file, and the gate check that runs on every verify. Newest issue date
 * first, because a superseding document is the one that answers "is this still current?".
 */
public interface OwnershipEvidenceRepository extends JpaRepository<OwnershipEvidence, UUID> {

    List<OwnershipEvidence> findByPropertyIdOrderByIssuedAtDesc(UUID propertyId);
}
