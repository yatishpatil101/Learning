package com.draazy.api.moderation.verification;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PropertyReviewRepository extends JpaRepository<PropertyReview, UUID> {

    /** {@code property_id} is UNIQUE, so a listing has at most one open case file. */
    Optional<PropertyReview> findByPropertyId(UUID propertyId);

    // Transaction-level lock prevents two inserts for the same case file.
    @Query(value = """
            select 1 from (
              select pg_advisory_xact_lock(hashtextextended(cast(:propertyId as text), 0))
            ) acquired
            """, nativeQuery = true)
    Integer lockCaseFileFor(@Param("propertyId") UUID propertyId);

    @Query("select count(m) > 0 from ReviewMessage m where m.review.id = :reviewId and m.internal = true and m.body = :body")
    boolean hasInternalNote(@Param("reviewId") UUID reviewId, @Param("body") String body);

    @Query("""
            select r from PropertyReview r
            where exists (select 1 from ReviewMessage m, Property p
                          where m.review = r and p.id = r.propertyId
                            and m.internal = false and m.readAt is null
                            and m.senderId = p.owner.id)
            order by r.lastMessageAt desc, r.id desc
            """)
    Page<PropertyReview> findAllAwaitingStaff(Pageable pageable);

    @Query("""
            select r.propertyId from PropertyReview r
            where r.propertyId in :propertyIds
              and exists (select 1 from ReviewMessage m, Property p
                          where m.review = r and p.id = r.propertyId
                            and m.internal = false and m.readAt is null
                            and m.senderId = p.owner.id)
            """)
    List<UUID> propertyIdsAwaitingStaff(@Param("propertyIds") Collection<UUID> propertyIds);

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
}
