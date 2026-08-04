package com.punenest.api.engagement.review;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Reads and writes over {@code reviews}.
 *
 * <p>Every finder here filters on {@code status = 'published'} and orders newest-first, which is
 * exactly the shape of {@code idx_reviews_target_created (target_type, target_id, created_at DESC)}
 * added in V16. The V7 index it replaced covered the filter but not the ordering, so a paged read
 * would have sorted every matching row on every page — worst for the targets with the most reviews.
 */
public interface ReviewRepository extends JpaRepository<Review, UUID> {

    /** Published reviews of one target, newest first, paged. Backs the entity-review route. */
    @Query("select r from Review r where r.targetType = :type and r.targetId = :id "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "' order by r.createdAt desc")
    Page<Review> findPublished(@Param("type") String type, @Param("id") String id,
            Pageable pageable);

    /**
     * The moderation queue: reviews of any status, newest first, optionally narrowed to one.
     *
     * <p><strong>The one finder here that does not filter to {@code published}</strong>, and the
     * only one that must not. Every other read serves the public, where an unpublished review has no
     * business appearing; this serves the staff queue, where a rejected or pending review is
     * precisely what is being looked for. Callers are role-gated at the controller.
     *
     * <p>{@code :status} being nullable makes one query serve both "the whole queue" and "just the
     * pending ones" — the alternative is two finders that must be kept in step, and this one's
     * ordering already matches {@code idx_reviews_target_created}'s trailing {@code created_at
     * DESC}.
     */
    @Query("select r from Review r where (:status is null or r.status = :status) "
            + "order by r.createdAt desc")
    Page<Review> findForModeration(@Param("status") String status, Pageable pageable);

    /**
     * Published reviews of one target, newest first, unpaged.
     *
     * <p>Unbounded reads are normally forbidden, and this one is the documented exception (D8.6):
     * a property's reviews are <em>structurally</em> bounded, because only someone with a completed
     * visit or a tenancy may write one and the UNIQUE index allows each of them exactly one. The
     * bound is an invariant enforced two layers down, not an optimistic assumption — and it is what
     * lets the property page keep computing its own rating summary without a second endpoint.
     */
    @Query("select r from Review r where r.targetType = :type and r.targetId = :id "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "' order by r.createdAt desc")
    List<Review> findPublished(@Param("type") String type, @Param("id") String id);

    /**
     * Has this author already reviewed this target?
     *
     * <p>The real guarantee is {@code idx_reviews_author_target}; this exists so the ordinary case
     * — someone revisiting a page they already reviewed — gets an explicable 409 instead of a
     * constraint-violation stack trace.
     */
    boolean existsByAuthorIdAndTargetTypeAndTargetId(UUID authorId, String targetType,
            String targetId);

    /**
     * Rating aggregates for a set of targets, in one query.
     *
     * <p>Computed on read and never stored. Slice 7 measured what happens to denormalised counters
     * in this schema — {@code localities.listing_count} and friends had already drifted, because
     * nothing maintained them — and a stored rating average has the same failure mode with higher
     * stakes. A counter that cannot drift is one that does not exist.
     *
     * @param targetIds the ids on the current page; the query never scans beyond them
     * @return rows of {@code [targetId, avgRating, reviewCount]}; targets with no published review
     *         are absent from the result rather than present with a zero
     */
    @Query("select r.targetId, avg(r.rating), count(r) from Review r "
            + "where r.targetType = :type and r.targetId in :targetIds "
            + "and r.status = '" + ReviewStatuses.PUBLISHED + "' group by r.targetId")
    List<Object[]> aggregateFor(@Param("type") String type,
            @Param("targetIds") Collection<String> targetIds);
}
