package com.draazy.api.engagement.saved;

import com.draazy.api.catalog.property.Property;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * Native access to the {@code saved_properties} join table. No JPA entity for this table —
 * it is a two-column composite PK with no surrogate id, and mapping it would mean
 * {@code @IdClass}/{@code @EmbeddedId} boilerplate whose only consumer is one list,
 * one insert and one delete. The same pattern as {@code SocietyRepository}'s follower queries.
 *
 * <p><strong>D8.9 — hard delete.</strong> This is a user preference (shortlist toggle), not a
 * business record. A tombstone defeats the PK's natural dedupe and provides no audit value.
 * This is the one deliberate exception to the platform's soft-delete rule.
 *
 * <p>Extends the bare {@link Repository} marker rather than {@code JpaRepository}: the domain type
 * parameter is {@code Property} only because Spring Data requires one, and inheriting the CRUD
 * surface would publish {@code findAll()}/{@code delete()} methods that operate on the
 * <em>properties</em> table. Property lookups belong to {@code PropertyRepository}, which the
 * service injects directly.
 */
public interface SavedPropertyRepository extends Repository<Property, UUID> {

    /**
     * The caller's saved property ids, newest first, paged. The join to {@code properties} happens
     * in the service (we fetch full entities so the mapper can produce {@code PropertySummary}).
     *
     * <p>The slice is applied here rather than to the entity fetch, so {@code findAllById} only ever
     * loads one page's worth of rows. A native paged query needs an explicit {@code countQuery} —
     * Spring Data can derive one from JPQL but not from raw SQL.
     */
    @Query(value = "select property_id from saved_properties where user_id = :userId order by created_at desc",
            countQuery = "select count(*) from saved_properties where user_id = :userId",
            nativeQuery = true)
    Page<UUID> findSavedPropertyIds(@Param("userId") UUID userId, Pageable pageable);

    /**
     * Idempotent save via {@code ON CONFLICT DO NOTHING} (D8.10). Returns 1 if inserted, 0 if
     * already present. No exception, no race, no rollback-only transaction on duplicate.
     */
    @Modifying
    @Query(value = "insert into saved_properties (user_id, property_id) values (:userId, :propertyId) on conflict do nothing",
            nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("propertyId") UUID propertyId);

    /** Hard delete. Returns 0 if nothing existed — the controller answers 204 either way. */
    @Modifying
    @Query(value = "delete from saved_properties where user_id = :userId and property_id = :propertyId",
            nativeQuery = true)
    int deleteByUserAndProperty(@Param("userId") UUID userId, @Param("propertyId") UUID propertyId);
}
