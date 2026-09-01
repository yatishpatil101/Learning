package com.punenest.api.moderation.verification;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PropertyReviewRepository extends JpaRepository<PropertyReview, UUID> {

    /** {@code property_id} is UNIQUE (V5), so a listing has at most one open case file. */
    Optional<PropertyReview> findByPropertyId(UUID propertyId);

    /**
     * Staff queue listing: the cases that have been spoken in most recently, first.
     *
     * <p>Ordered on {@code lastMessageAt} rather than {@code updatedAt} (V81/V82), because the queue
     * is a conversation queue and {@code updatedAt} could not see conversation. {@code
     * review_messages} owns the association, so posting a message inserted a child and left {@code
     * property_reviews} clean — neither {@code @UpdateTimestamp} nor the {@code set_updated_at}
     * trigger fired, and the case did not move. An owner replying to a moderator, and a duplicate
     * flag landing on a case that already existed, both sank to wherever the case already sat, which
     * for an old case is out of sight.
     *
     * <p>The column is total rather than coalesced against {@code updatedAt}: a case with no messages
     * carries the moment it was opened, so the sort key means the same thing on every row. {@code id}
     * is the tiebreak, and it is load-bearing rather than tidy — without a unique final term Postgres
     * may order equal instants differently per execution, and paging a queue with an unstable sort
     * shows one case twice and silently skips another.
     *
     * <p><strong>This currently sorts identically to {@code updatedAt}, and is still the right
     * column.</strong> Worth stating plainly, because the opposite is easy to assume: writing
     * {@code lastMessageAt} dirties the parent row, so {@code updatedAt} follows it, and the only
     * other writer that touches this row ({@code decide}) also posts a message. The two move in
     * lockstep today. The column is not defensive duplication — it is the write that makes the row
     * dirty at all, which was the entire bug — and it is the one that stays correct the first time
     * something touches a case without speaking in it. Sorting on {@code updatedAt} would put an
     * assignment, an SLA stamp or a priority flag at the head of a queue that is meant to be ordered
     * by who is waiting for a reply.
     */
    @Query("""
            select r from PropertyReview r
            order by r.lastMessageAt desc, r.id desc
            """)
    Page<PropertyReview> findAllForDesk(Pageable pageable);

    /**
     * The same page, narrowed to one owner's listings (D218).
     *
     * <p>A subquery rather than a join because {@link PropertyReview#getPropertyId()} is a plain
     * {@code UUID} column, not a {@code @ManyToOne}: the case file deliberately outlives nothing and
     * owns nothing, so there is no association to traverse. The ordering is baked in for the same
     * reason it is on {@link #findAllForDesk} — "what was said in most recently" is the only order
     * this queue is ever read in.
     *
     * <p>Case files that so far contain nothing but staff-only notes are excluded, matching the 404
     * the detail route gives the owner for the same case. Not cosmetic: a card that appears the
     * moment the duplicate probe fires tells the owner the probe fired, which is the existence
     * oracle the {@code internal} flag exists to close. The exclusion lapses as soon as a moderator
     * picks the case up or decides it, because at that point there is something here the owner is
     * entitled to see — and it never applies to a case with no messages at all, which is what an
     * owner who opened their own case file is looking at.
     */
    @Query("""
            select r from PropertyReview r
            where r.propertyId in (select p.id from Property p where p.owner.id = :ownerId)
              and (r.reviewer is not null
                   or r.decidedAt is not null
                   or exists (select 1 from ReviewMessage m
                              where m.review = r and m.internal = false)
                   or not exists (select 1 from ReviewMessage m2 where m2.review = r))
            order by r.lastMessageAt desc, r.id desc
            """)
    Page<PropertyReview> findAllForOwner(@Param("ownerId") UUID ownerId, Pageable pageable);
}
