package com.punenest.api.finance.rental;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Access to {@code tenant_rentals}.
 *
 * <p>Every query is scoped by {@code tenantId} and excludes soft-deleted rows, which is what lets
 * both of them ride V128's {@code idx_tenant_rentals_tenant} — defined {@code WHERE archived =
 * false}. The scope is not an optimisation: it is the only access control this table has, so a
 * query added later without it is a data leak rather than a slow read.
 *
 * <p><strong>Unpaged, deliberately.</strong> A person rents one home at a time and accumulates a
 * handful over a life; the count is bounded by how often they move, not by anything they can do to
 * the platform. Paging a list that will hold three rows would add a envelope the dashboard has to
 * unwrap on every read to answer a problem nobody has (api-standards.md §5.1).
 */
public interface TenantRentalRepository extends JpaRepository<TenantRental, UUID> {

    /** One tenant's live rentals, most recent lease first. */
    @Query("select r from TenantRental r where r.tenantId = :tenantId and r.archived = false "
            + "order by r.leaseStart desc, r.createdAt desc")
    List<TenantRental> findLiveByTenantId(@Param("tenantId") UUID tenantId);

    /**
     * One live row belonging to this tenant — the check every write performs.
     *
     * <p>The {@code tenantId} predicate is part of the lookup rather than an assertion afterwards
     * so that "not yours" and "not there" are the same query and therefore the same answer. A row
     * that exists but belongs to someone else must be indistinguishable from one that does not
     * exist, or the 403 confirms that a given id is a real rental.
     */
    @Query("select r from TenantRental r where r.id = :id and r.tenantId = :tenantId "
            + "and r.archived = false")
    Optional<TenantRental> findLiveByIdAndTenantId(@Param("id") UUID id,
                                                   @Param("tenantId") UUID tenantId);

    /** How many live rentals this tenant holds — the abuse ceiling {@code addRental} enforces. */
    @Query("select count(r) from TenantRental r where r.tenantId = :tenantId and r.archived = false")
    long countLiveByTenantId(@Param("tenantId") UUID tenantId);
}
