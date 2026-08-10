package com.punenest.api.services.request;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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

    /** The customer's own requests, newest first. Backed by {@code idx_service_requests_requester}. */
    @Query("""
            select r from ServiceRequest r
            where r.requesterId = :requesterId
              and (:type is null or r.type = :type)
              and (:status is null or r.status = :status)
            order by r.createdAt desc
            """)
    Page<ServiceRequest> findForRequester(@Param("requesterId") UUID requesterId,
            @Param("type") String type,
            @Param("status") String status,
            Pageable pageable);

    /**
     * The staff queue — every request that has entered it, newest first. A request still
     * {@code awaiting-payment} is deliberately excluded: ops does not work a rent agreement nobody
     * has paid for. It becomes visible the moment the payment webhook moves it to {@code new}.
     */
    @Query("""
            select r from ServiceRequest r
            where r.status <> 'awaiting-payment'
              and (:type is null or r.type = :type)
              and (:status is null or r.status = :status)
            order by r.createdAt desc
            """)
    Page<ServiceRequest> findForQueue(@Param("type") String type,
            @Param("status") String status,
            Pageable pageable);

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
    long countByRequesterIdAndTypeAndStatus(UUID requesterId, String type, String status);

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
    List<ServiceRequest> findStaleByStatus(@Param("status") String status,
            @Param("cutoff") Instant cutoff, Limit batch);
}
