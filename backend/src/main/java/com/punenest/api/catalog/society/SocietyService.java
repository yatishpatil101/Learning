package com.punenest.api.catalog.society;

import com.punenest.api.catalog.property.ListingCounts;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import com.punenest.api.catalog.property.PropertySummary;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.trust.RatingLookup;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
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
     * <p>Four queries for any page size: the page itself, the grouped listing counts, the grouped
     * follower counts, and — only when somebody is signed in — which of the page's societies they
     * follow. The naive shape would ask each of those questions once per row, which on an
     * unauthenticated endpoint is a denial-of-service a client can trigger for free.
     *
     * @param viewerId the caller, or {@code null} when anonymous
     */
    @Transactional(readOnly = true)
    public Page<SocietyResponse> browse(String q, String localitySlug, Pageable pageable,
            UUID viewerId) {
        Page<Society> page = societies.findAll(
                SocietySpecs.browse(q, localitySlug), SocietySort.sanitize(pageable));

        List<UUID> ids = page.getContent().stream().map(Society::getId).toList();
        Map<UUID, Long> listings = listingCounts.bySocietyId();
        Map<UUID, Long> followers = followerCounts(ids);
        Set<UUID> followed = followedBy(viewerId, ids);

        return page.map(society -> societyMapper.toResponse(
                society,
                listings.getOrDefault(society.getId(), 0L),
                followers.getOrDefault(society.getId(), 0L),
                followed.contains(society.getId())));
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
     * @param viewerId the caller, or {@code null} when anonymous
     * @throws NotFoundException if no society has this slug
     */
    @Transactional(readOnly = true)
    public SocietyDetailResponse get(String slug, UUID viewerId) {
        Society society = societies.findBySlug(slug)
                .orElseThrow(() -> NotFoundException.of("Society"));

        List<UUID> id = List.of(society.getId());
        List<PropertySummary> homes = properties
                .findBySocietyIdAndStatusAndArchivedFalseOrderByCreatedAtDesc(
                        society.getId(), PropertyStatus.APPROVED, PageRequest.of(0, MAX_HOMES))
                .stream().map(propertyMapper::toSummary).toList();

        RatingLookup.Rating rating = ratings.forSocieties(id).get(society.getId());

        return societyMapper.toDetail(
                society,
                listingCounts.forSocietyId(society.getId()),
                followerCounts(id).getOrDefault(society.getId(), 0L),
                followedBy(viewerId, id).contains(society.getId()),
                rating == null ? null : rating.average(),
                rating == null ? 0L : rating.reviewCount(),
                homes,
                List.of());
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
