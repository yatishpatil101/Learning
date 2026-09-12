package com.draazy.api.engagement.review;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.common.error.AlreadyReviewedException;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ReviewNotEligibleException;
import com.draazy.api.common.trust.PropertyExperience;
import com.draazy.api.common.trust.ReviewerStanding;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Reviews — reading them, and deciding who has earned the right to write one.
 *
 * <p><strong>The rule this class exists to enforce.</strong> Until now the anti-fake-review check
 * lived in the browser: {@code ReviewsSection.jsx} computes
 * {@code eligible = isIn && !isOwner && (hasCompletedVisit(...) || hasTenancy)} and hides the button
 * when it is false. Hiding a button is not a control. Anyone willing to call the API directly could
 * stack a listing with praise or bury a competitor's, and a marketplace whose ratings can be
 * manufactured has no ratings. The same three conditions are re-derived here, from data the caller
 * cannot influence, and are the only path to a stored row.
 *
 * <p>Property reviews and entity (society / locality / owner) reviews are deliberately asymmetric.
 * A property is something you can visit or live in, so a property review must be evidenced. A
 * locality is not — nobody "completes a visit" to a neighbourhood — so those are gated on
 * authentication and one-per-author alone. Demanding evidence there would mean nobody could ever
 * review a locality, which is not stricter, just broken.
 *
 * <p><strong>Moderation is post-hoc, and that is a decision, not an oversight.</strong> Every review
 * this class writes goes straight to {@link ReviewStatuses#PUBLISHED}; the {@code pending} and
 * {@code rejected} states exist in the vocabulary and the schema, but nothing here writes them.
 * Pre-moderation would mean an author posts a review and cannot see it, which reads as a bug and
 * suppresses honest reviews far more effectively than dishonest ones. The defence against abuse
 * here is the eligibility bar rather than a queue: to plant a review you must first hold a tenancy
 * or complete a visit on that specific property, which is expensive per fake review in a way that
 * creating an account is not. The moderation queue, the take-down path and the
 * {@code archived} column that reviews still lack are owned by the Moderation slice; until it
 * lands, a bad review can only be removed in the database.
 */
@Service
public class ReviewService {

    /** Writer for the {@code categories} column; symmetric with the mapper's reader. */
    private static final ObjectMapper CATEGORIES_JSON = JsonMapper.builder().build();

    /** One decimal place, matching how the UI renders a rating ("4.3") and {@code Society}. */
    private static final int RATING_SCALE = 1;

    private final ReviewRepository reviews;
    private final ReviewMapper mapper;
    private final ReviewTargetKey targetKey;
    private final PropertyRepository properties;
    private final PropertyExperience experience;
    private final UserRepository users;

    public ReviewService(ReviewRepository reviews, ReviewMapper mapper, ReviewTargetKey targetKey,
            PropertyRepository properties, PropertyExperience experience, UserRepository users) {
        this.reviews = reviews;
        this.mapper = mapper;
        this.targetKey = targetKey;
        this.properties = properties;
        this.experience = experience;
        this.users = users;
    }

    // ------------------------------------------------------------------ reads

    /**
     * Every published review of one listing, newest first.
     *
     * <p>Unpaged by ruling D8.6 — see {@link ReviewRepository#findPublished(String, String)} for why
     * that is safe here and nowhere else.
     */
    @Transactional(readOnly = true)
    public List<ReviewResponse> listForProperty(UUID propertyId) {
        requireReachableProperty(propertyId);
        return withAuthors(reviews.findPublished(ReviewTargetTypes.PROPERTY, propertyId.toString()));
    }

    /**
     * The rating summary for one listing: average, count, star distribution, per-aspect averages.
     *
     * <p><strong>Additive on purpose (D79).</strong> {@link #listForProperty} keeps returning every
     * published review, unpaged, exactly as before — nothing calling it has to change, and no page
     * boundary appears anywhere near the numbers this returns. What changes is that the three
     * figures the property page renders next to its stars no longer <em>depend</em> on the list
     * being whole: they come from four aggregate expressions and one grouped average, all evaluated
     * by Postgres. Should the list ever be paged, this is the piece that stops the summary quietly
     * becoming a summary of page one.
     *
     * <p>Two aggregate queries rather than one, because the two halves group differently: the star
     * buckets roll up over rows, the aspect averages over the entries of a JSONB document. Neither
     * loads a review. Three statements in total, counting the existence check the 404 needs.
     */
    @Transactional(readOnly = true)
    public ReviewSummaryResponse summaryForProperty(UUID propertyId) {
        requireReachableProperty(propertyId);
        String targetId = propertyId.toString();
        ReviewRatingTally tally = reviews.tallyFor(ReviewTargetTypes.PROPERTY, targetId);
        long total = nonNull(tally.reviewCount());
        return new ReviewSummaryResponse(
                // Null, not 0.0, when nobody has reviewed it — see ReviewSummaryResponse.
                total == 0 ? null : rounded(tally.avgRating()),
                total,
                distributionOf(tally),
                categoryAveragesFor(ReviewTargetTypes.PROPERTY, targetId));
    }

    /**
     * The moderation queue — reviews of every status, newest first, paged (staff/admin only).
     *
     * <p><strong>Why this exists.</strong> {@code PATCH /reviews/{id}/status} shipped able to take a
     * review down, with nothing able to list one: reviews are post-moderated, so they are published
     * on write, and every other read filters to {@code published}. A moderator could act only on a
     * review they already had the id of — which meant only ones that had been reported. Anything
     * nobody reported was unreachable, and so was the effect of any decision already made.
     *
     * <p>Paged, unlike {@link #listForProperty}. The D8.6 exception that lets a property's reviews
     * go unpaged rests on the per-target UNIQUE index bounding the count; across all targets and all
     * statuses there is no such bound, so this is the ordinary case rather than the exception.
     *
     * @param status one of the {@code ReviewStatuses} values, or null for the whole queue
     */
    @Transactional(readOnly = true)
    public Page<ReviewResponse> listForModeration(String status, Pageable pageable) {
        Page<Review> page = reviews.findForModeration(
                status == null || status.isBlank() ? null : status.strip(), pageable);
        Map<UUID, String> names = authorNames(page.getContent());
        /* `toModerationResponse`, not `toResponse`: this is the only read that returns rows of
           mixed status, so it is the only one whose rows have to say which status they are.

           Without it the endpoint's own primary mode was unusable. The Javadoc on
           `ReviewModerationController.queue` describes the useful call as "no filter at all
           (everything, newest first, which is how a moderator finds a review nobody has reported
           yet)" — and a mixed list in which nothing carries its status is a list a moderator cannot
           act on: they cannot see what has already been taken down, so the only safe reading of any
           row is "unknown". The filter parameter was the workaround, and it costs a round trip per
           status to reconstruct what one response should have carried. */
        return page.map(r -> mapper.toModerationResponse(r, nameOf(names, r)));
    }

    /** Published reviews of a society, locality or owner — paged, newest first (spec fix S27). */
    @Transactional(readOnly = true)
    public Page<ReviewResponse> listForEntity(String entityType, String entityId,
            Pageable pageable) {
        String key = targetKey.resolve(entityType, entityId);
        Page<Review> page = reviews.findPublished(entityType, key, pageable);
        Map<UUID, String> names = authorNames(page.getContent());
        return page.map(r -> mapper.toResponse(r, nameOf(names, r)));
    }

    /**
     * The rating summary for a society, locality or owner — the same four figures as
     * {@link #summaryForProperty}, over a different kind of target.
     *
     * <p><strong>Why this is the more urgent half of D79.</strong> The property list it was written
     * for is at least whole: {@link #listForProperty} is unpaged, so reducing it in the browser gave
     * the right answer. {@link #listForEntity} is <em>already</em> paged — 20 by default — so the
     * society hub, the owner profile and the locality reviews block have been averaging page one and
     * calling it the rating. The failure the property endpoint was built to prevent has already
     * happened here; this is not insurance, it is a fix.
     *
     * <p>One method for all three types because there is nothing type-specific left to write.
     * {@link ReviewTargetKey#resolve} is what makes that true: it validates the type, converts the
     * public identifier the client holds into the canonical {@code target_id} the table stores, and
     * 404s a target that does not exist — so by the time the aggregates run, a society and a
     * locality differ only in two strings. Splitting this into three would be three copies of one
     * query kept in step by hand.
     *
     * <p>Resolution is also the existence check, which is why there is no separate probe as there is
     * on the property path: a locality slug that matches nothing 404s instead of returning a
     * confident zero-review summary of a neighbourhood that does not exist.
     */
    @Transactional(readOnly = true)
    public ReviewSummaryResponse summaryForEntity(String entityType, String entityId) {
        String key = targetKey.resolve(entityType, entityId);
        ReviewRatingTally tally = reviews.tallyFor(entityType, key);
        long total = nonNull(tally.reviewCount());
        return new ReviewSummaryResponse(
                // Null, not 0.0, when nobody has reviewed it — see ReviewSummaryResponse.
                total == 0 ? null : rounded(tally.avgRating()),
                total,
                distributionOf(tally),
                categoryAveragesFor(entityType, key));
    }

    // ----------------------------------------------------------------- writes

    /**
     * Write a review of a listing, if the caller has actually experienced it.
     *
     * <p>Order of checks matters and is chosen so the caller always gets the most specific true
     * reason: the listing must exist (404) before we can say who owns it; an owner reviewing their
     * own listing is refused before we bother looking for visits; and the duplicate check precedes
     * the write so the common repeat-submit is a clean 409 rather than a constraint violation.
     */
    @Transactional
    public ReviewResponse createForProperty(UUID authorId, UUID propertyId,
            ReviewCreateRequest body) {
        Property property = requireProperty(propertyId);

        if (property.getOwner() != null && authorId.equals(property.getOwner().getId())) {
            throw new ReviewNotEligibleException("You cannot review your own listing");
        }

        ReviewerStanding standing = experience.standingOf(authorId, propertyId);
        if (standing == ReviewerStanding.NONE) {
            throw new ReviewNotEligibleException(
                    "Only someone who has completed a visit to this property, or held a tenancy on "
                            + "it, can review it");
        }

        Review review = persist(authorId, ReviewTargetTypes.PROPERTY, propertyId.toString(), body,
                ReviewContexts.fromStanding(standing));
        return mapper.toResponse(review, displayName(authorId));
    }

    /**
     * Write a review of a society, locality or owner.
     *
     * <p>No standing check and therefore no {@code context} badge: there is no visit or tenancy to
     * evidence against a neighbourhood. Authentication plus one-per-author is the whole guard, and
     * that asymmetry with property reviews is intentional rather than an oversight.
     */
    @Transactional
    public ReviewResponse createForEntity(UUID authorId, String entityType, String entityId,
            ReviewCreateRequest body) {
        String key = targetKey.resolve(entityType, entityId);
        Review review = persist(authorId, entityType, key, body, null);
        return mapper.toResponse(review, displayName(authorId));
    }

    // ---------------------------------------------------------------- helpers

    /**
     * The shared write path: duplicate check, category validation, insert.
     *
     * @param context the derived badge, or null for non-property targets
     */
    private Review persist(UUID authorId, String targetType, String targetId,
            ReviewCreateRequest body, String context) {
        if (reviews.existsByAuthorIdAndTargetTypeAndTargetId(authorId, targetType, targetId)) {
            throw new AlreadyReviewedException("You have already reviewed this");
        }

        Map<String, Integer> categories;
        try {
            // Per target type: `accuracy` is a listing aspect and `Safety` a society one, and a
            // key that belongs to the other vocabulary is refused rather than dropped. Dropping it
            // would return 201 for a review whose aspect bar then renders empty — the write looks
            // like it worked, the reader sees nothing, and nobody learns the key was wrong.
            categories = ReviewCategories.validated(targetType, body.categories());
        } catch (IllegalArgumentException rejected) {
            throw new BadRequestException(rejected.getMessage());
        }

        Review review = new Review(targetType, targetId, authorId, body.rating());
        review.setTitle(body.title());
        review.setBody(body.body());
        review.setRecommend(body.recommend());
        review.setContext(context);
        review.setCategories(CATEGORIES_JSON.writeValueAsString(categories));
        // Post-moderation, deliberately. See the class Javadoc.
        review.setStatus(ReviewStatuses.PUBLISHED);
        return reviews.save(review);
    }

    private Property requireProperty(UUID propertyId) {
        return properties.findById(propertyId)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }

    /**
     * The 404 gate for the two <em>anonymous</em> property-review reads.
     *
     * <p>Separate from {@link #requireProperty} because the two callers want different questions
     * answered. A public read must apply the same visibility floor the public detail route applies
     * ({@link Property#isDirectlyReachable()}): without it, a caller holding a UUID gets a 404 from
     * {@code GET /properties/{id}} and a 200 from {@code /reviews} and {@code /reviews/summary},
     * which confirms that a listing moderation rejected — or an owner archived — is still on file,
     * and in the list case hands over its reviewers' names and review bodies. The write path keeps
     * the unfiltered lookup on purpose: an owner may legitimately still be reviewed on a listing
     * that has since gone terminal or been pulled, and flooring that would silently delete the
     * eligibility of anyone who actually dealt with them.
     *
     * <p>An existence probe, not a fetch — neither caller needs a column of the row.
     */
    private void requireReachableProperty(UUID propertyId) {
        if (!properties.existsByIdAndArchivedFalseAndStatusIn(
                propertyId, PropertyStatus.DIRECTLY_REACHABLE)) {
            throw NotFoundException.of("Property");
        }
    }

    /**
     * The author id is nullable, so the lookup is guarded rather than passed straight through:
     * when no row has an author {@link #authorNames} returns {@code Map.of()}, and an immutable
     * map rejects a null key with an NPE instead of answering "absent".
     *
     * <p>Lives in one place because it was originally written out at each of the three call sites
     * and fixed at only one of them. The two that were missed are both reachable: a locality whose
     * reviews are all seeded is public and anonymous, and an all-seeded moderation page is routine,
     * so each was a 500 waiting on data rather than on code.
     */
    private String nameOf(Map<UUID, String> names, Review row) {
        return row.getAuthorId() == null ? null : names.get(row.getAuthorId());
    }

    private List<ReviewResponse> withAuthors(List<Review> rows) {
        Map<UUID, String> names = authorNames(rows);
        return rows.stream()
                .map(r -> mapper.toResponse(r, nameOf(names, r)))
                .toList();
    }

    /**
     * Display names for a whole page of reviews in one query.
     *
     * <p>The obvious alternative — resolving the author inside the row mapping — is an N+1 on a
     * public, anonymous endpoint, which is the cheapest denial-of-service a listing page can offer.
     */
    private Map<UUID, String> authorNames(List<Review> rows) {
        Set<UUID> ids = rows.stream()
                .map(Review::getAuthorId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> names = new HashMap<>();
        for (User u : users.findAllById(ids)) {
            names.put(u.getId(), u.getName());
        }
        return names;
    }

    private String displayName(UUID userId) {
        return users.findById(userId).map(User::getName).orElse(null);
    }

    // ------------------------------------------------------- summary helpers

    /**
     * The five buckets as a wire map, always all five and zero-filled.
     *
     * <p>Absent-means-zero is the shape a {@code group by rating} would hand back, and it pushes the
     * zero-fill onto every client instead of doing it once here. A bar chart with a missing bar and
     * a bar chart with a zero-height bar are not the same picture.
     */
    private static Map<String, Long> distributionOf(ReviewRatingTally tally) {
        Map<String, Long> stars = new LinkedHashMap<>();
        stars.put("1", nonNull(tally.star1()));
        stars.put("2", nonNull(tally.star2()));
        stars.put("3", nonNull(tally.star3()));
        stars.put("4", nonNull(tally.star4()));
        stars.put("5", nonNull(tally.star5()));
        return stars;
    }

    /**
     * Per-aspect means, over the vocabulary that <em>this</em> kind of target uses.
     *
     * <p>The key list is the same one {@link #persist} validates against, from the same method. A
     * read pinned to the property vocabulary is exactly why the society hub's bars were empty: the
     * aggregate's {@code c.key in (:keys)} filter silently discarded any society aspect before it
     * could be averaged, so the fix has to land on both sides of the column or on neither.
     */
    private Map<String, BigDecimal> categoryAveragesFor(String targetType, String targetId) {
        Map<String, BigDecimal> averages = new LinkedHashMap<>();
        for (ReviewCategoryAverage row : reviews.categoryAveragesFor(
                targetType, targetId, ReviewCategories.forTarget(targetType))) {
            if (row.getAverage() != null) {
                averages.put(row.getCategory(),
                        row.getAverage().setScale(RATING_SCALE, RoundingMode.HALF_UP));
            }
        }
        return averages;
    }

    private static BigDecimal rounded(Double average) {
        return average == null ? null
                : BigDecimal.valueOf(average).setScale(RATING_SCALE, RoundingMode.HALF_UP);
    }

    /** {@code count()} cannot be null, but a constructor expression cannot select a primitive. */
    private static long nonNull(Long count) {
        return count == null ? 0L : count;
    }
}
