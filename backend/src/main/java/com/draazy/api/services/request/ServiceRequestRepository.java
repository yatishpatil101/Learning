package com.draazy.api.services.request;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

// Customer and queue lists are separate to avoid nullable requester scope leaks.
public interface ServiceRequestRepository extends JpaRepository<ServiceRequest, UUID> {

    // Only accepted parties can see co-filled requests; invites alone are requester claims.
    @Query("""
            select r from ServiceRequest r
            where (r.requesterId = :requesterId
                   or exists (select 1 from ServiceRequestParty p
                              where p.requestId = r.id
                                and p.userId = :requesterId
                                and p.status = 'accepted'))
              and (:type is null or r.type = :type)
              and (:status is null or r.status = :status)
              and (:ticketId is null or r.ticketId = :ticketId)
            order by r.createdAt desc
            """)
    Page<ServiceRequest> findForRequester(@Param("requesterId") UUID requesterId,
            @Param("type") String type,
            @Param("status") ServiceRequestStatus status,
            @Param("ticketId") UUID ticketId,
            Pageable pageable);

    // Single-row form of requester/accepted-party scope behind visible().
    @Query("""
            select count(r) > 0 from ServiceRequest r
            where r.id = :id
              and (r.requesterId = :userId
                   or exists (select 1 from ServiceRequestParty p
                              where p.requestId = r.id
                                and p.userId = :userId
                                and p.status = 'accepted'))
            """)
    boolean isParticipant(@Param("id") UUID id, @Param("userId") UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select r from ServiceRequest r
            where r.id = :id
            """)
    Optional<ServiceRequest> findByIdForUpdate(@Param("id") UUID id);

    // The staff queue — every request on the given desk that has entered it, newest first.
    // A request still awaiting-payment is deliberately excluded: ops does not work a rent agreement nobody has paid for.
    // Teams are resolved by the service from the caller, never taken from ?team= as-is.
    @Query("""
            select r from ServiceRequest r
            where r.status <> com.draazy.api.services.request.ServiceRequestStatus.AWAITING_PAYMENT
              and (:allTeams = true or r.team in :teams)
              and (:type is null or r.type = :type)
              and (:anyStatus = true or r.status in :statuses)
              and (:ticketId is null or r.ticketId = :ticketId)
              and (:unassigned = false or r.assigneeId is null)
              and (:mine = false or r.assigneeId = :assigneeId)
              and (:overdue = false
                   or (r.type = 'rent-agreement'
                       and ((r.status = com.draazy.api.services.request.ServiceRequestStatus.NEW
                             and r.statusChangedAt < :pickupBy)
                            or (r.status in (com.draazy.api.services.request.ServiceRequestStatus.ASSIGNED,
                                             com.draazy.api.services.request.ServiceRequestStatus.IN_PROGRESS)
                                and r.statusChangedAt < :draftBy)
                            or (r.status = com.draazy.api.services.request.ServiceRequestStatus.CHANGES_REQUESTED
                                and r.statusChangedAt < :revisionBy)
                            or (r.status = com.draazy.api.services.request.ServiceRequestStatus.APPROVED
                                and r.statusChangedAt < :registrationBy))))
              and (:prefix is null
                   or (:requestId is not null and r.id = :requestId)
                   or exists (select 1 from User u
                              where u.id = r.requesterId
                                and (lower(u.name) like :prefix escape '\\'
                                     or u.mobile like :prefix escape '\\')))
            order by r.createdAt desc
            """)
    Page<ServiceRequest> findForQueue(@Param("allTeams") boolean allTeams,
            @Param("teams") List<String> teams,
            @Param("type") String type,
            @Param("anyStatus") boolean anyStatus,
            @Param("statuses") List<ServiceRequestStatus> statuses,
            @Param("ticketId") UUID ticketId,
            @Param("unassigned") boolean unassigned,
            @Param("mine") boolean mine,
            @Param("assigneeId") UUID assigneeId,
            @Param("overdue") boolean overdue,
            @Param("pickupBy") Instant pickupBy,
            @Param("draftBy") Instant draftBy,
            @Param("revisionBy") Instant revisionBy,
            @Param("registrationBy") Instant registrationBy,
            @Param("prefix") String prefix,
            @Param("requestId") UUID requestId,
            Pageable pageable);

    @Query("""
            select r.status as status, count(r) as total
            from ServiceRequest r
            where r.status <> com.draazy.api.services.request.ServiceRequestStatus.AWAITING_PAYMENT
              and (:allTeams = true or r.team in :teams)
            group by r.status
            """)
    List<StatusTotal> countQueueByStatus(@Param("allTeams") boolean allTeams,
            @Param("teams") List<String> teams);

    @Query("""
            select count(r) from ServiceRequest r
            where r.status <> com.draazy.api.services.request.ServiceRequestStatus.AWAITING_PAYMENT
              and (:allTeams = true or r.team in :teams)
              and r.assigneeId = :assigneeId
              and r.status in :statuses
            """)
    long countMineForQueue(@Param("allTeams") boolean allTeams,
            @Param("teams") List<String> teams,
            @Param("assigneeId") UUID assigneeId,
            @Param("statuses") List<ServiceRequestStatus> statuses);

    @Query("""
            select count(r) from ServiceRequest r
            where r.status <> com.draazy.api.services.request.ServiceRequestStatus.AWAITING_PAYMENT
              and (:allTeams = true or r.team in :teams)
              and r.type = 'rent-agreement'
              and ((r.status = com.draazy.api.services.request.ServiceRequestStatus.NEW
                    and r.statusChangedAt < :pickupBy)
                   or (r.status in (com.draazy.api.services.request.ServiceRequestStatus.ASSIGNED,
                                    com.draazy.api.services.request.ServiceRequestStatus.IN_PROGRESS)
                       and r.statusChangedAt < :draftBy)
                   or (r.status = com.draazy.api.services.request.ServiceRequestStatus.CHANGES_REQUESTED
                       and r.statusChangedAt < :revisionBy)
                   or (r.status = com.draazy.api.services.request.ServiceRequestStatus.APPROVED
                       and r.statusChangedAt < :registrationBy))
            """)
    long countOverdueForQueue(@Param("allTeams") boolean allTeams,
            @Param("teams") List<String> teams,
            @Param("pickupBy") Instant pickupBy,
            @Param("draftBy") Instant draftBy,
            @Param("revisionBy") Instant revisionBy,
            @Param("registrationBy") Instant registrationBy);

    interface StatusTotal {
        ServiceRequestStatus getStatus();

        Long getTotal();
    }

    // Optional is enforced by uq_service_requests_ticket partial unique index.
    Optional<ServiceRequest> findByTicketId(UUID ticketId);

    // The request behind a Cashfree order, so the payment webhook can settle it.
    Optional<ServiceRequest> findByPaymentRef(String paymentRef);

    // Fast path only: concurrent creates can both count zero before inserting.
    long countByRequesterIdAndTypeAndStatus(UUID requesterId, String type,
            ServiceRequestStatus status);

    // Awaiting-payment with stale update means no settled money arrived yet.
    @Query("""
            select r from ServiceRequest r
            where r.status = :status
              and ((r.paymentRef is not null and r.updatedAt < :cutoff)
                or (r.paymentRef is null and r.updatedAt < :incompleteCutoff))
            order by r.updatedAt asc
            """)
    List<ServiceRequest> findStaleByStatus(@Param("status") ServiceRequestStatus status,
            @Param("cutoff") Instant cutoff, @Param("incompleteCutoff") Instant incompleteCutoff,
            Limit batch);

    @Query(value = """
            select r.* from service_requests r
            where r.type = 'rent-agreement' and r.id <> :id
              and r.status not in ('awaiting-payment', 'cancelled')
              and ((cast(:propertyId as uuid) is not null and r.property_id = cast(:propertyId as uuid))
                or (cast(:flat as text) is not null
                  and regexp_replace(lower(coalesce(r.details #>> '{_state,prop,flatNo}', '')), '[^a-z0-9]', '', 'g')
                    || '|' || regexp_replace(lower(coalesce(r.details #>> '{_state,prop,society}', '')), '[^a-z0-9]', '', 'g')
                    || '|' || regexp_replace(lower(coalesce(r.details #>> '{_state,prop,pincode}', '')), '[^a-z0-9]', '', 'g')
                    = cast(:flat as text)))
            order by r.created_at asc
            limit 50
            """, nativeQuery = true)
    List<ServiceRequest> findRentAgreementsOnFlat(@Param("id") UUID id,
            @Param("propertyId") String propertyId, @Param("flat") String flat);
}
