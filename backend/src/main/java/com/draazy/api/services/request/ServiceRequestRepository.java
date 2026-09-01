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

/**
 * Service-request reads.
 *
 * <p>The two list queries are separate rather than one query with a nullable requester, because
 * they are not the same question: {@link #findForRequester} is "my requests" and
 * {@link #findForQueue} is "the whole queue". Collapsing them into a single method with a nullable
 * scope parameter is exactly the shape in which somebody later passes {@code null} on the customer
 * path and hands one customer everybody else's paperwork.
 */
public interface ServiceRequestRepository extends JpaRepository<ServiceRequest, UUID> {

    /**
     * The customer's own requests — raised by them, or co-filled with them (D121). Newest first.
     *
     * <p>Backed by {@code idx_service_requests_requester} for the common half and
     * {@code idx_service_request_parties_user} for the correlated {@code exists}, which reads at most
     * a handful of rows: a person is a party to a few agreements, never to a queue's worth.
     *
     * <p><strong>Only an {@code accepted} party.</strong> An invitation is a claim the requester made
     * about somebody else; until that somebody confirms it, a mistyped mobile that happens to resolve
     * to a real account would put a stranger's rent, deposit and identity documents on this page. The
     * pending invitation is visible on {@code GET /me/service-request-invites} instead, which shows
     * the invitation and nothing of the agreement.
     *
     * <p>The name kept its {@code ForRequester} shape and the scope parameter is still non-nullable,
     * which is the property that matters: this is "the requests this person is on", and there is no
     * argument you can pass to make it mean anything else.
     */
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

    /**
     * Is this person on this request at all — as its requester, or as an accepted co-fill party
     * (D121)? The single-row form of {@link #findForRequester}'s scope clause, and the guard behind
     * {@code ServiceRequestService.visible}.
     *
     * <p>One query rather than a fetch-and-compare so the two cannot drift: a participant test that
     * says yes on the list and no on the detail is a request a customer can see the existence of and
     * not open.
     */
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

    /** Same row fetch as {@link #findById}, but write-locked for checkout-open serialization. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select r from ServiceRequest r
            where r.id = :id
            """)
    Optional<ServiceRequest> findByIdForUpdate(@Param("id") UUID id);

    /**
     * The staff queue — every request on the given desk that has entered it, newest first. A request
     * still {@code awaiting-payment} is deliberately excluded: ops does not work a rent agreement
     * nobody has paid for. It becomes visible the moment the payment webhook moves it to {@code new}.
     *
     * <p><strong>{@code team} is resolved by the service, never taken from the caller's
     * {@code ?team=}</strong> — exactly as {@code TicketRepository.findForBoard} is. A staff member's
     * desk is pinned to their own; only an admin's filter reaches this parameter, and only then does
     * {@code null} mean "every desk". See {@code ServiceRequestService.list} for why the staff case
     * with no desk is decided before the query rather than by passing null into it: null here means
     * "all", which is the opposite of what a deskless staff account should see.
     *
     * <p>Backed by {@code idx_service_requests_team_status} (V72).
     */
    @Query("""
            select r from ServiceRequest r
            where r.status <> com.draazy.api.services.request.ServiceRequestStatus.AWAITING_PAYMENT
              and (:team is null or r.team = :team)
              and (:type is null or r.type = :type)
              and (:status is null or r.status = :status)
              and (:ticketId is null or r.ticketId = :ticketId)
            order by r.createdAt desc
            """)
    Page<ServiceRequest> findForQueue(@Param("team") String team,
            @Param("type") String type,
            @Param("status") ServiceRequestStatus status,
            @Param("ticketId") UUID ticketId,
            Pageable pageable);

    /**
     * The request that mirrors a ticket, if one does (D45) — the board-to-workflow direction of the
     * link whose other half is {@code ServiceRequest.ticketId}.
     *
     * <p>{@code Optional}, not a list, and that is enforced rather than assumed:
     * {@code uq_service_requests_ticket} (V72) is a partial unique index on the column, so a ticket
     * cannot acquire a second request behind this method's back.
     */
    Optional<ServiceRequest> findByTicketId(UUID ticketId);

    /** The request behind a Cashfree order, so the payment webhook can settle it. */
    Optional<ServiceRequest> findByPaymentRef(String paymentRef);

    /**
     * How many priced requests this caller is already holding open but unpaid.
     *
     * <p>Every one of these opened a live gateway order. Without a ceiling, a script calling
     * {@code POST /service-requests} in a loop opens unbounded real orders against our merchant
     * account at no cost to itself — see {@code ServiceRequestService.create}.
     *
     * <p><strong>This count is the fast path, not the guarantee</strong> (D153). It is a read with
     * no lock over rows that do not exist yet, so two concurrent creates both see zero and both
     * insert. What actually holds the cap is {@code uq_service_requests_open_unpaid} (V43); this
     * stays because it produces the better message on the ordinary double click, which is the case
     * that happens hourly rather than the one that happens under attack.
     */
    long countByRequesterIdAndTypeAndStatus(UUID requesterId, String type,
            ServiceRequestStatus status);

    /**
     * Checkouts that were opened and then walked away from — {@code awaiting-payment} rows older
     * than the sweep's TTL (D152).
     *
     * <p>The status filter is also the never-paid proof: a settled payment moves the request to
     * {@code new} and a refused one to {@code cancelled}, so a row still sitting here is one no
     * money has ever arrived for, whether or not it carries a gateway order id.
     *
     * <p>Ordered oldest-first and taken a {@code batch} at a time, as the other three families now
     * are (D161): the order decides which rows a bounded run retires, and the bound keeps a
     * post-outage backlog — and any version conflict inside it — from taking one transaction down
     * with it.
     */
    @Query("""
            select r from ServiceRequest r
            where r.status = :status
              and r.createdAt < :cutoff
            order by r.createdAt asc
            """)
    List<ServiceRequest> findStaleByStatus(@Param("status") ServiceRequestStatus status,
            @Param("cutoff") Instant cutoff, Limit batch);
}
