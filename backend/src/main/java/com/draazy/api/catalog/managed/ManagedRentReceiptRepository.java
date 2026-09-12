package com.draazy.api.catalog.managed;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Manual rent receipts, always read through the managed property that owns them (V120).
 *
 * <p>There is deliberately no "find by id" read. A receipt is reachable only from a property the
 * caller has already been proved to own, which is what keeps the ownership check in one place —
 * {@code ManagedPropertyService.ownedRecord} — instead of once per query here.
 */
interface ManagedRentReceiptRepository extends JpaRepository<ManagedRentReceipt, UUID> {

    /**
     * The newest {@code limit} receipts for one property. Newest-first works on a plain string sort
     * because {@code rent_month} is a zero-padded {@code YYYY-MM} (V120's CHECK is what guarantees
     * that), and the unique index on {@code (managed_property_id, rent_month)} already delivers the
     * order. {@link Limit} rather than a {@code findTopN} method name so the page size stays a
     * caller's argument — the endpoint takes {@code ?months=}.
     */
    List<ManagedRentReceipt> findByManagedPropertyIdOrderByRentMonthDesc(UUID managedPropertyId, Limit limit);

    boolean existsByManagedPropertyIdAndRentMonth(UUID managedPropertyId, String rentMonth);
}
