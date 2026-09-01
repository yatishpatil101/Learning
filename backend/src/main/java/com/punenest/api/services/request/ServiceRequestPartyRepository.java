package com.punenest.api.services.request;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The co-fill parties of a service request (D121).
 *
 * <p>Every finder is scoped — by request, by the person asking, or by the number the invitation was
 * addressed to. There is deliberately no {@code findByRole} or bare {@code findByStatus}: the two
 * questions this table answers are "who else is on this matter" and "what am I invited to", and a
 * repository method that answers neither is one somebody later calls without a scope. See
 * {@code ServiceRequestRepository}'s note on the same discipline for what that costs when it goes
 * wrong.
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

    /** Whether this request has at least one party in the named invitation status. */
    boolean existsByRequestIdAndStatus(UUID requestId, String status);

    /** How many parties of this request are in the named invitation status. */
    long countByRequestIdAndStatus(UUID requestId, String status);

    /** Whether this specific user is on this request with the named invitation status. */
    boolean existsByRequestIdAndUserIdAndStatus(UUID requestId, UUID userId, String status);

    /**
     * The one row that decides whether this person may be invited onto this request at all.
     *
     * <p>Read before the insert only to produce a better message than the unique index would; the
     * index is what actually holds the rule, exactly as {@code uq_service_requests_open_unpaid}
     * does for the unpaid cap.
     */
    boolean existsByRequestIdAndUserId(UUID requestId, UUID userId);

    /**
     * The invitations waiting for this number's owner to register (V107).
     *
     * <p>The one finder here that is not scoped to a request or to a user id, and the exception is
     * the point rather than an oversight: a mobile <em>is</em> the scope while there is no account
     * to key on. It is only ever called with the caller's own verified number — see
     * {@code CoFillParties.claimPendingFor}, which is the sole caller and takes the number from the
     * {@code users} row rather than from anything a client sent.
     *
     * <p>Unclaimed rows only, by construction: V107's {@code addressee} CHECK means a non-null
     * mobile and a null {@code user_id} are the same condition.
     */
    List<ServiceRequestParty> findByMobile(String mobile);

    /** Whether an unclaimed invitation to this number is already on this request. */
    boolean existsByRequestIdAndMobile(UUID requestId, String mobile);

    /**
     * Drop every invitation whose clock has run out. The retention sweep's whole statement.
     *
     * <p>A delete rather than a blanking, unlike most of the retention code here: there is no
     * remainder worth keeping. The row's only content beyond the number is which side of a matter
     * nobody ever joined, and the matter itself records that an invitation was sent in its timeline.
     */
    long deleteByInviteExpiresAtBefore(Instant cutoff);
}
