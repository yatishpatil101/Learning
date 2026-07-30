package com.punenest.api.catalog.property;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Spring Data access for {@link Property}. Extends {@link JpaSpecificationExecutor} so the public
 * search composes its facets as a {@link org.springframework.data.jpa.domain.Specification}
 * ({@link PropertySpecs}) rather than a combinatorial explosion of derived-query methods — the
 * predicate it builds (forced {@code archived=false AND status='approved'} + the equality/range
 * facets) is exactly what the partial {@code idx_properties_search} covers.
 *
 * <p>The detail/owner-scoped finders pull the owner via an {@link EntityGraph} so the owner summary
 * is initialized inside the service transaction — the DTO can be mapped at the controller edge
 * without a lazy-load blowing up, and without an N+1 across a page of listings.
 */
public interface PropertyRepository
        extends JpaRepository<Property, UUID>, JpaSpecificationExecutor<Property> {

    /** By-id with the owner eagerly attached, for the public detail projection. */
    @Override
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findById(UUID id);

    /** By-slug with the owner attached — the contract path param accepts a slug or id. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlug(String slug);

    /** Owner-scoped single fetch by id (returns empty for another owner's row → 404, never a leak). */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findByIdAndOwner_Id(UUID id, UUID ownerId);

    /** Owner-scoped single fetch by slug. */
    @EntityGraph(attributePaths = "owner")
    Optional<Property> findBySlugAndOwner_Id(String slug, UUID ownerId);

    /** The caller's own listings (all statuses incl. archived), owner-scoped; hits idx_properties_owner. */
    @EntityGraph(attributePaths = "owner")
    Page<Property> findByOwner_Id(UUID ownerId, Pageable pageable);

    /**
     * Just the ids of an owner's listings — the key set the contacts feature needs to scope an owner's
     * inbox, since {@code contact_requests} has no {@code owner_id} column of its own.
     *
     * <p>A projection rather than {@code findByOwner_Id(...).map(Property::getId)} because the caller
     * wants none of the 40-odd listing columns and none of the owner graph; this is an index-only read
     * against {@code idx_properties_owner}.
     */
    @Query("select p.id from Property p where p.owner.id = :ownerId")
    List<UUID> findIdsByOwnerId(@Param("ownerId") UUID ownerId);

    /**
     * Featured-first live listings for the homepage strip. Featured desc puts {@code true} ahead of
     * {@code false}; the {@link Pageable} caps the result (the contract endpoint takes no limit).
     * Summary projection only, so no owner graph.
     */
    List<Property> findByStatusAndArchivedFalseOrderByFeaturedDescCreatedAtDesc(
            String status, Pageable limit);
}
