package com.draazy.api.engagement.review;

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

    /**
     * Count, average and the 1–5 star distribution for one target, in one aggregate query (D79).
     *
     * <p>{@link #aggregateFor} already answers "average and how many" for a page of targets, and it
     * is deliberately left alone: it is a per-target roll-up for cards, and widening it to carry a
     * distribution would make every society card pay for five counts it does not render. This is the
     * detail-page counterpart — one target, everything that page shows.
     *
     * <p><strong>{@code count(case when ...)} rather than {@code sum(case when ... then 1 else 0)}.
     * </strong> Both compute the same bucket, but {@code count} is defined to return a
     * non-null integral zero over no rows, where {@code sum} returns null — so the unreviewed
     * listing needs no special case anywhere above this line.
     *
     * <p>Always returns exactly one row: an aggregate query with no {@code group by} does, even when
     * nothing matches. That is the empty-property case, and it arrives as
     * {@code (0, null, 0, 0, 0, 0, 0)} rather than as an absent result to guard against.
     */
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

    /**
     * Mean sub-rating per aspect for one target, averaged in the database (D79).
     *
     * <p>Native, and it has to be: {@code categories} is a JSONB document, so the rows being averaged
     * do not exist until {@code jsonb_each} expands it, and JPQL has no way to say that. The
     * alternative is the thing this item is about — read every review, parse every document in Java,
     * and hope two callers reduce them the same way.
     *
     * <p>Four deliberate guards, none of them theoretical for a column that is user-generated and
     * predates its own validation:
     * <ul>
     *   <li>{@code jsonb_each} raises on a non-object, and a {@code where} clause cannot save it —
     *       the function is evaluated to produce the rows the filter would run over. The type check
     *       therefore sits <em>inside</em> the argument, where the order of evaluation is decided.</li>
     *   <li>{@code jsonb_typeof(c.value) = 'number'} keeps a non-numeric value out of the cast
     *       rather than letting it abort the whole query, and with it the listing page.</li>
     *   <li>{@code c.value between '1' and '5'} keeps an out-of-range number out of the mean. The
     *       write path bounds these to 1–5 but nothing in the schema does, so one seeded row or one
     *       hand-run UPDATE carrying {@code {"locality": 99}} would publish a 99.0 average against a
     *       5-point scale — and unlike a bad type, that produces no error to notice. Compared as
     *       JSONB rather than as a cast on purpose: conjunct evaluation order within a single
     *       {@code where} is cost-driven, so a second cast here could be planned ahead of the type
     *       check and reintroduce exactly the failure the guard above prevents.</li>
     *   <li>{@code c.key in (:keys)} pins the result to the closed vocabulary, so a key that reached
     *       the column before {@link ReviewCategories} existed cannot appear in the response and
     *       widen the contract by accident.</li>
     * </ul>
     *
     * <p>Written with {@code cast(... as ...)} rather than Postgres's {@code ::} shorthand: {@code ::}
     * inside a native query is ambiguous with named-parameter syntax, and the spelling that cannot be
     * misread is worth more than the four characters.
     *
     * @param keys the aspects worth returning — normally {@link ReviewCategories#KEYS}
     * @return one row per aspect somebody actually rated, key-ordered; aspects nobody rated are
     *         absent rather than present with a zero
     */
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
