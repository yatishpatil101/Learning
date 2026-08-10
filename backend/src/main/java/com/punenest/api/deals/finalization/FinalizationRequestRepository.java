package com.punenest.api.deals.finalization;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Access to {@code finalization_requests}. Queries are designed N+1-safe: list reads batch-load
 * users separately rather than relying on lazy associations.
 */
public interface FinalizationRequestRepository extends JpaRepository<FinalizationRequest, UUID> {

    /** Service pre-check for the duplicate-prevention message (backed by the partial unique index). */
    @Query("select fr from FinalizationRequest fr " +
           "where fr.initiatorId = :initiatorId and fr.propertyId = :propertyId " +
           "and fr.status = 'pending'")
    Optional<FinalizationRequest> findLiveByInitiatorAndProperty(
            @Param("initiatorId") UUID initiatorId,
            @Param("propertyId") UUID propertyId);

    /** The caller-relevant live request for a property (where they are initiator or counterparty). */
    @Query("select fr from FinalizationRequest fr " +
           "where fr.propertyId = :propertyId and fr.status = 'pending' " +
           "and (fr.initiatorId = :callerId or fr.counterpartyId = :callerId)")
    Optional<FinalizationRequest> findLiveByPropertyAndParticipant(
            @Param("propertyId") UUID propertyId,
            @Param("callerId") UUID callerId);

    /**
     * The caller's most recent request on a property, <strong>whatever its status</strong> — used by
     * the status read so a declined or cancelled request is distinguishable from never having asked
     * (D111). Call with {@code PageRequest.of(0, 1)}; the first element is the newest.
     */
    @Query("select fr from FinalizationRequest fr " +
           "where fr.propertyId = :propertyId " +
           "and (fr.initiatorId = :callerId or fr.counterpartyId = :callerId) " +
           "order by fr.createdAt desc")
    List<FinalizationRequest> findRecentByPropertyAndParticipant(
            @Param("propertyId") UUID propertyId,
            @Param("callerId") UUID callerId,
            Pageable pageable);

    /**
     * One page of the requests awaiting the caller's decision (counterparty = caller, pending),
     * newest first.
     *
     * <p>The count query is spelled out rather than derived: the read query carries its own
     * {@code order by}, and an explicit counterpart is both cheaper and immune to a derivation that
     * changes between Spring Data versions. Hits {@code idx_finalization_counterparty_created}
     * (V47) \u2014 before that index this predicate had no index at all and scanned the table.
     */
    @Query(value = "select fr from FinalizationRequest fr "
                 + "where fr.counterpartyId = :counterpartyId and fr.status = 'pending' "
                 + "order by fr.createdAt desc",
           countQuery = "select count(fr) from FinalizationRequest fr "
                      + "where fr.counterpartyId = :counterpartyId and fr.status = 'pending'")
    Page<FinalizationRequest> findPendingByCounterparty(
            @Param("counterpartyId") UUID counterpartyId,
            Pageable pageable);

    /**
     * Auto-decline: set all OTHER pending requests on the same property to declined, except the
     * one being accepted. This is the sibling auto-decline that fires transactionally with accept.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update FinalizationRequest fr set fr.status = 'declined' " +
           "where fr.propertyId = :propertyId and fr.status = 'pending' " +
           "and fr.id <> :excludeId")
    int declineSiblings(@Param("propertyId") UUID propertyId, @Param("excludeId") UUID excludeId);
}
