package com.draazy.api.moderation.verification;

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
     * Hold the right to open <em>this listing's</em> case file until the calling transaction ends.
     * Rationale: docs/flows/admin/property-verification.md#case-file-advisory-lock.
     */
    @Query(value = """
            select 1 from (
              select pg_advisory_xact_lock(hashtextextended(cast(:propertyId as text), 0))
            ) acquired
            """, nativeQuery = true)
    Integer lockCaseFileFor(@Param("propertyId") UUID propertyId);

    /**
     * Staff queue listing: the cases spoken in most recently, first. Ordered on
     * {@code lastMessageAt} with {@code id} as a load-bearing tiebreak for stable paging.
     */
    @Query("""
            select r from PropertyReview r
            order by r.lastMessageAt desc, r.id desc
            """)
    Page<PropertyReview> findAllForDesk(Pageable pageable);

    /**
     * The same page, narrowed to one owner's listings. Cases holding only staff-only notes are
     * excluded, matching the 404 the detail route gives: a card would be an existence oracle.
     */
    @Query("""
            select r from PropertyReview r
            where r.propertyId in (select p.id from Property p where p.owner.id = :ownerId)
              and (r.reviewer is not null
                   or r.decidedAt is not null
                   or exists (select 1 from ReviewMessage m
                              where m.review = r and m.internal = false)
                   or not exists (select 1 from ReviewMessage m2 where m2.review = r))
            order by coalesce((select max(m3.createdAt) from ReviewMessage m3
                               where m3.review = r and m3.internal = false), r.createdAt) desc, r.id desc
            """)
    Page<PropertyReview> findAllForOwner(@Param("ownerId") UUID ownerId, Pageable pageable);

    @Query("""
            select count(m) from ReviewMessage m
            where m.internal = false and m.readAt is null
              and (m.senderId is null or m.senderId <> :ownerId)
              and m.review.propertyId in (select p.id from Property p where p.owner.id = :ownerId)
            """)
    long countUnreadForOwner(@Param("ownerId") UUID ownerId);
}
