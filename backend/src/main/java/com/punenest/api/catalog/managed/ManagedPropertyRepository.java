package com.punenest.api.catalog.managed;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Data access for {@link ManagedProperty}. Every read is owner-scoped — there is no cross-user
 * query by design (a managed record is private to the person who registered it).
 */
public interface ManagedPropertyRepository extends JpaRepository<ManagedProperty, UUID> {

    /** The caller's own managed records, newest first (id tiebreaker for a deterministic order). */
    List<ManagedProperty> findByOwnerIdOrderByCreatedAtDescIdDesc(UUID ownerId);

    /**
     * The record adopting or spawned by a given listing, if one exists.
     *
     * <p>The only query here that is not owner-scoped, and deliberately so: it exists to answer "is
     * this listing already spoken for?" before adopting it, and the answer has to be true even when
     * the other record belongs to someone else. It is never used to <em>return</em> a record to a
     * caller — {@code register} only reads whether it is present. The partial unique index added in
     * V93 is the real guarantee; this turns the race it would lose into a 409 with a sentence.
     */
    Optional<ManagedProperty> findByPublishedListingId(UUID publishedListingId);
}
