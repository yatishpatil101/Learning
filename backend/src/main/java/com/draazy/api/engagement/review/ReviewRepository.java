package com.draazy.api.engagement.review;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Finders filter on published and order newest-first to match {@code idx_reviews_target_created},
 * which avoids sorting every matching row on each page. */
public interface ReviewRepository extends JpaRepository<Review, UUID> {

    /** Published reviews of one target, newest first, paged. Backs the entity-review route. */
    @Query("select r from Review r where r.targetType = :type and r.targetId = :id "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "' order by r.createdAt desc")
    Page<Review> findPublished(@Param("type") String type, @Param("id") String id,
            Pageable pageable);

    /** The only finder not filtered to {@code published}: the staff queue must see rejected and pending ones. */
    @Query("select r from Review r where (:status is null or r.status = :status) "
            + "and (:like is null or lower(coalesce(r.body, '')) like :like or lower(r.targetId) like :like "
            + "or r.authorId in (select u.id from User u where lower(coalesce(u.name, '')) like :like)) "
            + "order by r.createdAt desc")
    Page<Review> findForModeration(@Param("status") String status, @Param("like") String like,
            Pageable pageable);

    @Query("select r.status, count(r) from Review r group by r.status")
    List<Object[]> countByStatus();

    /** Unpaged on purpose: a property's reviews are structurally bounded, since only a completed visit or tenancy
     * may write one and the unique index allows each person exactly one. */
    @Query("select r from Review r where r.targetType = :type and r.targetId = :id "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "' order by r.createdAt desc")
    List<Review> findPublished(@Param("type") String type, @Param("id") String id);

    /** The real guarantee is {@code idx_reviews_author_target}; this gives a revisiting author a clean 409
     * instead of a constraint-violation stack trace. */
    boolean existsByAuthorIdAndTargetTypeAndTargetId(UUID authorId, String targetType,
            String targetId);

    /** Computed on read, never stored: denormalised counters drift in this schema, and a stored rating
     * average would fail the same way. */
    @Query("select r.targetId, avg(r.rating), count(r) from Review r "
            + "where r.targetType = :type and r.targetId in :targetIds "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "' group by r.targetId")
    List<Object[]> aggregateFor(@Param("type") String type,
            @Param("targetIds") Collection<String> targetIds);

    /** {@code count(case when ...)} rather than {@code sum}: count returns zero over no rows where sum returns
     * null, so an unreviewed listing needs no special case. */
    @Query("select new com.draazy.api.engagement.review.ReviewRatingTally("
            + "count(r), avg(r.rating), "
            + "count(case when r.rating = 1 then 1 end), "
            + "count(case when r.rating = 2 then 1 end), "
            + "count(case when r.rating = 3 then 1 end), "
            + "count(case when r.rating = 4 then 1 end), "
            + "count(case when r.rating = 5 then 1 end)) "
            + "from Review r where r.targetType = :type and r.targetId = :id "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "'")
    ReviewRatingTally tallyFor(@Param("type") String type, @Param("id") String id);

    /** Native: rows exist only after {@code jsonb_each}, which raises on a non-object, so the type check must sit
     * inside its argument; a {@code where} clause would be evaluated too late. */
    @Query(value = "select c.key as category, "
            + "avg(cast(c.value #>> '{}' as numeric)) as average "
            + "from reviews r cross join lateral jsonb_each("
            + "case when jsonb_typeof(r.categories) = 'object' "
            + "then r.categories else cast('{}' as jsonb) end) c "
            + "where r.target_type = :type and r.target_id = :id "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "' "
            + "and c.key in (:keys) and jsonb_typeof(c.value) = 'number' "
            + "and c.value between cast('1' as jsonb) and cast('5' as jsonb) "
            + "group by c.key order by c.key", nativeQuery = true)
    List<ReviewCategoryAverage> categoryAveragesFor(@Param("type") String type,
            @Param("id") String id, @Param("keys") Collection<String> keys);
}
