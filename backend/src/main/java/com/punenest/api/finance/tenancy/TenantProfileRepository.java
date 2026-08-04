package com.punenest.api.finance.tenancy;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Access to {@code tenant_profiles}, keyed by the owning user's id.
 *
 * <p>Deliberately minimal. There is no finder by name, occupation, income band or occupant type,
 * and none should be added from this feature: a query that returns a <em>list</em> of tenant
 * profiles is the platform-wide enumeration that spec fix S10 exists to prevent. Every read here
 * starts from a user id the caller has already earned the right to name.
 */
public interface TenantProfileRepository extends JpaRepository<TenantProfile, UUID> {
}
