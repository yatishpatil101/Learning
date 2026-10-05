package com.draazy.api.finance.tenancy;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TenancyRepository extends JpaRepository<Tenancy, UUID> {

    @Query("select t from Tenancy t where t.propertyId = :propertyId and t.status = 'active'")
    Optional<Tenancy> findActiveByPropertyId(@Param("propertyId") UUID propertyId);

    @Query("select t from Tenancy t where t.propertyId = :propertyId order by t.startDate desc")
    List<Tenancy> findByPropertyId(@Param("propertyId") UUID propertyId);

    @Query("select t from Tenancy t where t.tenantId = :tenantId "
            + "order by case when t.status = 'active' then 0 else 1 end, t.startDate desc")
    List<Tenancy> findByTenantId(@Param("tenantId") UUID tenantId);

    // Existence-only so a caller cannot read tenancy contents while checking access.
    @Query("select count(t) > 0 from Tenancy t where "
            + "(t.ownerId = :a and t.tenantId = :b) or (t.ownerId = :b and t.tenantId = :a)")
    boolean existsBetween(@Param("a") UUID a, @Param("b") UUID b);

    // Deliberately not filtered by status.
    // A former tenant who lived somewhere for two years is the single most credible reviewer a prospective one could read.
    boolean existsByTenantIdAndPropertyId(UUID tenantId, UUID propertyId);
}
