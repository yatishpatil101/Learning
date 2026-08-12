package com.punenest.api.services.request;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The co-fill parties of a service request (D121).
 *
 * <p>Every finder is scoped — by request, or by the person asking. There is deliberately no
 * {@code findByRole} or bare {@code findByStatus}: the two questions this table answers are "who
 * else is on this matter" and "what am I invited to", and a repository method that answers neither
 * is one somebody later calls without a scope. See {@code ServiceRequestRepository}'s note on the
 * same discipline for what that costs when it goes wrong.
 */
public interface ServiceRequestPartyRepository extends JpaRepository<ServiceRequestParty, UUID> {

    /** Every party of one request, for the detail read. */
    List<ServiceRequestParty> findByRequestId(UUID requestId);

    /**
     * Every party of a page of requests, for {@code ServiceRequestMapper.toDtos} — the fifth and
     * last {@code IN} query that keeps a staff page off the N+1 path.
     */
    List<ServiceRequestParty> findByRequestIdIn(List<UUID> requestIds);

    /** This person's outstanding invitations, newest first. */
    List<ServiceRequestParty> findByUserIdAndStatusOrderByCreatedAtDesc(UUID userId, String status);

    /**
     * The one row that decides whether this person may be invited onto this request at all.
     *
     * <p>Read before the insert only to produce a better message than the unique index would; the
     * index is what actually holds the rule, exactly as {@code uq_service_requests_open_unpaid}
     * does for the unpaid cap.
     */
    boolean existsByRequestIdAndUserId(UUID requestId, UUID userId);
}
