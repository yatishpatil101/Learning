package com.punenest.api.services.request;

import java.util.UUID;
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

    /** The staff queue — every request on the platform, newest first. */
    @Query("""
            select r from ServiceRequest r
            where (:type is null or r.type = :type)
              and (:status is null or r.status = :status)
            order by r.createdAt desc
            """)
    Page<ServiceRequest> findForQueue(@Param("type") String type,
            @Param("status") String status,
            Pageable pageable);
}
