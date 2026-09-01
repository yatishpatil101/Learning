package com.punenest.api.leads.photos;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Reads over {@code photo_requests}. Both finders are shaped to hit a V117 index —
 * {@code uq_photo_requests_requester_property} for the idempotency probe and
 * {@code idx_photo_requests_property} for the owner inbox.
 */
public interface PhotoRequestRepository extends JpaRepository<PhotoRequest, UUID> {

    /**
     * This caller's existing request against one listing — the idempotency probe. A hit means
     * "return the existing row and tell the client it is a repeat", never "insert a second one".
     *
     * <p>Not filtered by status, matching the unique index it rides: a resolved request still blocks
     * a re-ask, or an owner who adds photos becomes immediately re-nagg-able by the same buyer.
     */
    Optional<PhotoRequest> findByRequesterIdAndPropertyId(UUID requesterId, UUID propertyId);

    /**
     * The owner's inbox: every request against the listings they own, newest first, paged.
     *
     * <p>Takes the owner's property ids rather than an owner id because {@code photo_requests} has no
     * {@code owner_id} column — ownership lives on {@code properties}. Same shape and same reasoning
     * as the contact inbox: one round trip regardless of size, no N+1, and an empty collection is
     * short-circuited by the caller without a query.
     */
    Page<PhotoRequest> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds, Pageable pageable);

    /**
     * The owner's "add photos" badge — counted in the database, not by fetching the inbox and
     * filtering it. The inbox is paged, so a client-side filter would silently under-count the moment
     * an owner had more than one page (the exact bug D78 recorded against the contact badge).
     */
    long countByPropertyIdInAndStatus(Collection<UUID> propertyIds, String status);
}
