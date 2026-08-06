package com.punenest.api.leads.contact;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
     * The owner's inbox: every request against the listings they own, newest first, paged.
     *
     * <p>Takes the owner's property ids rather than an owner id because {@code contact_requests} has
     * no {@code owner_id} column — ownership lives on {@code properties}. Passing the id set keeps
     * this query inside the {@code leads} context and inside
     * {@code idx_contact_requests_property}, and it is a single round trip regardless of inbox size
     * (no N+1). An empty collection short-circuits to an empty page without a query.
     *
     * <p><strong>Paged as of the contact-integration slice (tech-debt D78).</strong> It was a bare
     * array on the argument that an owner's inbox is small — but this is the one collection on the
     * platform that grows with <em>demand</em> rather than with the owner's own actions: every buyer
     * who wants a number adds a row, so the owner whose listing is doing well is precisely the one
     * the unpaged read punishes.
     */
    Page<ContactRequest> findByPropertyIdInOrderByCreatedAtDesc(Collection<UUID> propertyIds,
            Pageable pageable);

    /**
     * How many of the owner's requests are still waiting on them.
     *
     * <p>Exists because paging the inbox broke the way this number used to be produced: the client
     * fetched the whole array and filtered it. That is correct only while "the whole array" and "one
     * page" are the same thing. Counted in the database instead — the badge is then right regardless
     * of how many pages the inbox has, and the client no longer downloads an inbox to display an
     * integer.
     */
    long countByPropertyIdInAndStatus(Collection<UUID> propertyIds, String status);

    /**
     * Whether {@code requesterId} holds an approved contact request against any listing owned by
     * {@code ownerId} — one half of the relationship guard on {@code GET /tenant-profiles/{mobile}}
     * (spec fix S10).
     *
     * <p>Lives here rather than in {@code finance} because it is a question about this table, and a
     * feature that owns a table owns the queries over it. Expressed as a single existence check
     * with the ownership test as a subquery: the alternative — fetch the owner's property ids, then
     * probe each — is an N+1 on the read that decides whether a stranger may see a tenant's income.
     *
     * <p>The join to {@code properties} is the documented {@code leads → catalog} exception
     * ({@code package-structure.md} §2).
     */
    @Query("""
            select count(cr) > 0 from ContactRequest cr
            where cr.requesterId = :requesterId
              and cr.status = :status
              and cr.propertyId in (select p.id from Property p where p.owner.id = :ownerId)
            """)
    boolean existsApprovedForOwner(@Param("requesterId") UUID requesterId,
                                   @Param("ownerId") UUID ownerId,
                                   @Param("status") String status);
}
