package com.punenest.api.catalog.managed;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Data access for {@link ManagedProperty}. Every read is owner-scoped — there is no cross-user
 * query by design (a managed record is private to the person who registered it).
 */
public interface ManagedPropertyRepository extends JpaRepository<ManagedProperty, UUID> {

    /** The caller's own managed records, newest first (id tiebreaker for a deterministic order). */
    List<ManagedProperty> findByOwnerIdOrderByCreatedAtDescIdDesc(UUID ownerId);
}
