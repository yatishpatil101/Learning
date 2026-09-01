package com.punenest.api.catalog.society;

import com.punenest.api.catalog.property.ListingCounts;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.catalog.property.PropertySummary;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.RatingLookup;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The society directory and the society hub.
 *
 * <p>Both reads are public, so {@code viewerId} is {@code null} for an anonymous caller and every
 * caller-relative field ({@code followedByMe}) degrades to {@code false} rather than failing. The
 * standing risk on this surface is not leakage — nothing here is private — but cost: these are
 * endpoints anyone can call in a loop, so every aggregate is page-scoped and none is per-row.
 */
@Service
public class SocietyService {

    /** Cap on the {@code homes} array of a society hub. */
    private static final int MAX_HOMES = 50;

    private final SocietyRepository societies;
    private final PropertyRepository properties;
    private final PropertyMapper propertyMapper;
    private final ListingCounts listingCounts;
    private final SocietyMapper societyMapper;
    private final RatingLookup ratings;

    public SocietyService(SocietyRepository societies, PropertyRepository properties,
            PropertyMapper propertyMapper, ListingCounts listingCounts,
            SocietyMapper societyMapper, RatingLookup ratings) {
        this.societies = societies;
        this.properties = properties;
        this.propertyMapper = propertyMapper;
        this.listingCounts = listingCounts;
        this.societyMapper = societyMapper;
        this.ratings = ratings;
    }

    /**
     * Browse the directory.
     *
     * <p>Six queries for any page size: the page itself, the merge lookup, the grouped listing
     * counts, the grouped follower counts, the grouped rating aggregates, and — only when somebody
     * is signed in — which of the page's societies they follow. The naive shape would ask each of
     * those questions once per row, which on an unauthenticated endpoint is a denial-of-service a
     * client can trigger for free.
     *
     * <p>The rating is here rather than only on the hub because the cards render it: the directory
     * and the home page both show a star per society, and resolving that per card would be one
     * request per row from the browser as well as one query per row on the server.
     *
     * @param viewerId the caller, or {@code null} when anonymous
     */
    @Transactional(readOnly = true)
    public Page<SocietyResponse> browse(String q, String localitySlug, Pageable pageable,
            UUID viewerId) {
        Page<Society> page = societies.findAll(
                SocietySpecs.browse(q, localitySlug), SocietySort.sanitize(pageable));
        List<SocietyResponse> rows = summarise(page.getContent(), viewerId);
        return new PageImpl<>(rows, page.getPageable(), page.getTotalElements());
    }

    /**
     * Turn a page's worth of societies into cards, in the order given.
     *
     * <p>Extracted from {@link #browse} so the follow list ({@code GET /me/societies/following},
     * D227) renders identical cards. The alternative — a second assembly in the Engagement slice —
     * would have been a place for the two to drift, and the drift would be silent: a society would
     * simply show a different follower count or a missing star depending on which screen you found
     * it on.
     *
     * <p>Six queries whatever the page size, and none of them per row. The caller supplies the
     * order and this preserves it, because a follow list is ordered by when you followed, which is a
     * fact this class cannot see.
     *
     * <p><strong>The sixth query is the merge lookup</strong> (V111), and every aggregate below is
     * taken over the society <em>and everything merged into it</em>. That is what makes a merge mean
     * something: a merge that hid the duplicate without consolidating it would leave the building's
     * listings, followers and reviews split across two rows, one of which is now invisible — which
     * is strictly worse than the duplicate an operator was looking at when they merged.
     *
     * @param page the societies to render, already ordered and already limited
     * @param viewerId the caller, or {@code null} when anonymous
     */
    @Transactional(readOnly = true)
    public List<SocietyResponse> summarise(List<Society> page, UUID viewerId) {
        List<UUID> ids = page.stream().map(Society::getId).toList();
        Map<UUID, List<UUID>> families = families(ids);
        List<UUID> reach = families.values().stream().flatMap(List::stream).toList();

        Map<UUID, Long> listings = listingCounts.bySocietyId();
        Map<UUID, Long> followers = followerCounts(reach);
        Set<UUID> followed = followedBy(viewerId, reach);
        Map<UUID, RatingLookup.Rating> rated = ratings.forSocieties(reach);

        return page.stream().map(society -> {
            List<UUID> family = families.get(society.getId());
            // Absent, not zero: `forSocieties` omits unrated societies precisely so this stays a
            // null average rather than a 0.0 the card would render as a one-star society.
            RatingLookup.Rating rating = combinedRating(rated, family);
            return societyMapper.toResponse(
                    society,
                    sum(listings, family),
                    sum(followers, family),
                    family.stream().anyMatch(followed::contains),
                    rating == null ? null : rating.average(),
                    rating == null ? 0L : rating.reviewCount());
        }).toList();
    }

    /**
     * One society hub by slug.
     *
     * <p>{@code homes} is capped at {@value #MAX_HOMES}. A society with hundreds of live listings is
     * a page nobody scrolls to the end of, and an uncapped array here would make the largest society
     * the cheapest way to make the server do the most work.
     *
     * <p>{@code avgRating} and {@code reviewCount} are live as of slice 8. They were null and 0 here
     * on purpose until the Engagement slice decided how a society review keys (it keys on the id);
     * the values now come from {@link RatingLookup}, computed rather than stored. An unrated society
     * still reports a null average — no rating is not a rating of zero.
     *
     * <p>{@code reviews} stays empty: the contract serves a society's reviews from
     * {@code GET /reviews/society/{slug}}, which is paged. Inlining an unbounded array of them into
     * the hub would undo that.
     *
     * <p><strong>A slug an operator merged away resolves here rather than 404ing</strong> (V111),
     * and the response carries the survivor's slug — which is how a client knows to canonicalise its
     * own URL. 404 was the other option and it is the wrong one: the merged-away slug is in Google's
     * index, in shared links, in the {@code society} field of every listing filed under it and in
     * every alert somebody set on it. Merging two rows an operator judged to be one building would
     * then break all of them, and the operator has no way to know that in advance.
     *
     * <p>Everything the hub counts is taken over the society and everything merged into it, so the
     * page shows the whole building rather than the half of it that happened to win.
     *
     * @param viewerId the caller, or {@code null} when anonymous
     * @throws NotFoundException if no society has this slug
     */
    @Transactional(readOnly = true)
    public SocietyDetailResponse get(String slug, UUID viewerId) {
        Society society = SocietyMergePointer.survivor(societies, societies.findBySlug(slug)
                .orElseThrow(() -> NotFoundException.of("Society")));

        List<UUID> family = families(List.of(society.getId())).get(society.getId());
        List<PropertySummary> homes = properties
                .findBySocietyIdInAndStatusAndArchivedFalseOrderByCreatedAtDesc(
                        family, PropertyStatus.APPROVED, PageRequest.of(0, MAX_HOMES))
                .stream().map(propertyMapper::toSummary).toList();

        RatingLookup.Rating rating = combinedRating(ratings.forSocieties(family), family);
        Set<UUID> followed = followedBy(viewerId, family);

        return societyMapper.toDetail(
                society,
                family.stream().mapToLong(listingCounts::forSocietyId).sum(),
                sum(followerCounts(family), family),
                family.stream().anyMatch(followed::contains),
                rating == null ? null : rating.average(),
                rating == null ? 0L : rating.reviewCount(),
                homes,
                List.of());
    }

    /**
     * Each of these societies together with everything merged into it, keyed by the survivor.
     *
     * <p>One query for the whole page, served by {@code idx_society_merged_into}, which is partial —
     * so this costs a lookup into the tens of merged rows however large the catalogue grows. Asking
     * per row instead would put an N+1 on {@code GET /societies}, which is unauthenticated and
     * therefore an N+1 anybody can trigger for free.
     *
     * <p>The survivor is always the first entry, and a society nobody merged anything into gets a
     * list of exactly itself. That is deliberate: it means the aggregate code below has one shape,
     * not a merged shape and an unmerged one, and it makes the unmerged case — which is all but a
     * handful of societies — provably identical to what this class did before V111.
     */
    private Map<UUID, List<UUID>> families(List<UUID> survivorIds) {
        Map<UUID, List<UUID>> families = new LinkedHashMap<>();
        for (UUID id : survivorIds) {
            families.put(id, new ArrayList<>(List.of(id)));
        }
        if (survivorIds.isEmpty()) {
            return families;
        }
        for (Object[] row : societies.findMergedInto(survivorIds)) {
            families.get((UUID) row[0]).add((UUID) row[1]);
        }
        return families;
    }

    /** A per-society aggregate totalled over the family. Absent keys are zero, as they always were. */
    private static long sum(Map<UUID, Long> counts, List<UUID> family) {
        return family.stream().mapToLong(id -> counts.getOrDefault(id, 0L)).sum();
    }

    /**
     * One rating for a merged building, weighted by how many reviews each row's average was over.
     *
     * <p>Weighted and not a plain mean of the two averages, which would let a duplicate carrying one
     * five-star review drag a survivor's 3.9-from-two-hundred up to 4.45. The arithmetic here is the
     * same as if every review had been written against one society, which is the claim a merge
     * makes.
     *
     * <p><strong>The single-society case returns the stored aggregate untouched</strong> rather than
     * running it through the arithmetic. Not an optimisation — it is what makes this change provably
     * invisible to the hundreds of societies nobody has merged anything into: no re-rounding, so no
     * card's star can move by a decimal because a feature they are not using shipped.
     *
     * @return null when nothing in the family has a published review — no rating is not a rating of
     *     zero, and the card renders the two differently
     */
    private static RatingLookup.Rating combinedRating(
            Map<UUID, RatingLookup.Rating> rated, List<UUID> family) {
        if (family.size() == 1) {
            return rated.get(family.get(0));
        }
        BigDecimal weighted = BigDecimal.ZERO;
        long reviews = 0;
        for (UUID id : family) {
            RatingLookup.Rating one = rated.get(id);
            if (one == null || one.reviewCount() == 0) {
                continue;
            }
            weighted = weighted.add(one.average().multiply(BigDecimal.valueOf(one.reviewCount())));
            reviews += one.reviewCount();
        }
        if (reviews == 0) {
            return null;
        }
        return new RatingLookup.Rating(
                weighted.divide(BigDecimal.valueOf(reviews), 2, RoundingMode.HALF_UP), reviews);
    }

    /** Follower counts for the given societies. Empty input short-circuits — an {@code IN ()} is not SQL. */
    private Map<UUID, Long> followerCounts(List<UUID> societyIds) {
        if (societyIds.isEmpty()) {
            return Map.of();
        }
        return societies.countFollowersFor(societyIds).stream()
                .collect(Collectors.toMap(
                        row -> (UUID) row[0],
                        row -> ((Number) row[1]).longValue()));
    }

    /** Which of the given societies this caller follows; empty for an anonymous one. */
    private Set<UUID> followedBy(UUID viewerId, List<UUID> societyIds) {
        if (viewerId == null || societyIds.isEmpty()) {
            return Set.of();
        }
        return new HashSet<>(societies.findFollowedAmong(viewerId, societyIds));
    }
}
