package com.punenest.api.finance.ledger;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Access to {@code ownership_basis}. Keyed by {@code property_id}, which V6 makes the primary key —
 * hence {@code JpaRepository<OwnershipBasis, UUID>} needs no finder of its own: {@code findById}
 * already means "the basis for this property".
 */
public interface OwnershipBasisRepository extends JpaRepository<OwnershipBasis, UUID> {
}
