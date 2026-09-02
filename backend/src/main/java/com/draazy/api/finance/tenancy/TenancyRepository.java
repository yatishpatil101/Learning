package com.draazy.api.finance.tenancy;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Access to {@code tenancies}.
 *
 * <p>{@code tenancies} carries no soft-delete triplet and deliberately gains none: a tenancy is
 * never deleted, only moved to a terminal status. The history of who lived in a flat is the record,
 * so there is nothing for an {@code archived} flag to express that {@link TenancyStatuses} does not
 * already say more precisely.
 *
 * <p>The status-filtered finders ride {@code V10__DDL_tenancy_finance.sql}'s {@code idx_tenancies_owner_status} /
 * {@code idx_tenancies_tenant_status}.
 */
public interface TenancyRepository extends JpaRepository<Tenancy, UUID> {

    /** The live tenancy on a property, if any. At most one exists — V12 enforces it. */
    @Query("select t from Tenancy t where t.propertyId = :propertyId and t.status = 'active'")
    Optional<Tenancy> findActiveByPropertyId(@Param("propertyId") UUID propertyId);

    /** Every tenancy on a property, newest first — the occupancy history. */
    @Query("select t from Tenancy t where t.propertyId = :propertyId order by t.startDate desc")
    List<Tenancy> findByPropertyId(@Param("propertyId") UUID propertyId);

    /** Tenancies on the caller's listings, live first then by recency. */
    @Query("select t from Tenancy t where t.ownerId = :ownerId "
            + "order by case when t.status = 'active' then 0 else 1 end, t.startDate desc")
    List<Tenancy> findByOwnerId(@Param("ownerId") UUID ownerId);

    /** Tenancies the caller holds as tenant, live first then by recency. */
    @Query("select t from Tenancy t where t.tenantId = :tenantId "
            + "order by case when t.status = 'active' then 0 else 1 end, t.startDate desc")
    List<Tenancy> findByTenantId(@Param("tenantId") UUID tenantId);

    /**
     * Whether these two users have ever shared a tenancy, in either direction.
     *
     * <p>This is the relationship check that guards {@code GET /tenant-profiles/{mobile}} (spec fix
     * S10). Written as an existence check rather than a fetch so the caller cannot accidentally
     * read the tenancy's own contents while merely asking whether it exists.
     */
    @Query("select count(t) > 0 from Tenancy t where "
            + "(t.ownerId = :a and t.tenantId = :b) or (t.ownerId = :b and t.tenantId = :a)")
    boolean existsBetween(@Param("a") UUID a, @Param("b") UUID b);

    /**
     * Has this user ever been the tenant of this property? Backs the review-eligibility port
     * ({@code common.trust.PropertyExperience}).
     *
     * <p>Deliberately not filtered by status. A former tenant who lived somewhere for two years is
     * the single most credible reviewer a prospective one could read; restricting this to
     * {@code active} would silence exactly the people with the most to say, and would mean a
     * reviewer's badge could evaporate the day their lease ended.
     */
    boolean existsByTenantIdAndPropertyId(UUID tenantId, UUID propertyId);
}
