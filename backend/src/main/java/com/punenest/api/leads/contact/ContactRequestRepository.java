package com.punenest.api.leads.contact;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Reads over {@code contact_requests}. Every finder here is deliberately shaped to hit one of the two
 * V4 indexes — {@code idx_contact_requests_requester} for the viewer-side lookups and
 * {@code idx_contact_requests_property} for the owner inbox — because this table is read on every
 * property-detail render and grows with traffic rather than with inventory.
 */
public interface ContactRequestRepository extends JpaRepository<ContactRequest, UUID> {

    /**
     * The viewer's own request against one listing. Also the idempotency probe for
     * {@code requestContact}: a hit means "return the existing status", never "insert a second row".
     * Uses {@code idx_contact_requests_requester}.
     */
    Optional<ContactRequest> findByRequesterIdAndPropertyId(UUID requesterId, UUID propertyId);

    /**
     * The reveal predicate, as a cheap existence check rather than a fetch — the property mapper asks
     * this on every authenticated detail render and needs no columns back.
     */
    boolean existsByRequesterIdAndPropertyIdAndStatus(UUID requesterId, UUID propertyId, String status);

    /**
     * The owner's inbox: every request against the listings they own, newest first.
     *
     * <p>Takes the owner's property ids rather than an owner id because {@code contact_requests} has
     * no {@code owner_id} column — ownership lives on {@code properties}. Passing the id set keeps
     * this query inside the {@code leads} context and inside
     * {@code idx_contact_requests_property}, and it is a single round trip regardless of inbox size
     * (no N+1). An empty collection short-circuits to an empty list without a query.
     */
    List<ContactRequest> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds);
}
