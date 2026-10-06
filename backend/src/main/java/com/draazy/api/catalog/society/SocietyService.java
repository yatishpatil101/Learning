package com.draazy.api.catalog.society;

import com.draazy.api.catalog.property.ListingCounts;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.catalog.property.PropertyStatus;
import com.draazy.api.catalog.property.PropertySummary;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.RatingLookup;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Public reads callable in a loop, so every aggregate is page-scoped, never per-row. */
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
     * Browse the directory: six queries for any page size, never one per row (societies.md 9.2).
     * {@code hasListings} is {@code TRUE} only from the home rail - see {@link SocietySpecs#browse}.
     */
    @Transactional(readOnly = true)
    public Page<SocietyResponse> browse(String q, String localitySlug, Boolean hasListings,
            Boolean verified, Pageable pageable, UUID viewerId) {
        Specification<Society> spec = SocietySpecs.browse(q, localitySlug, hasListings, verified);
        Optional<String> ranking = SocietySort.ranking(pageable);
        if (ranking.isPresent()) {
            return ranked(spec, ranking.get(), pageable, viewerId);
        }
        Pageable safe = SocietySort.sanitize(pageable);
        Page<Society> page = societies.findAll(spec, SocietySort.tieBroken(safe));
        List<SocietyResponse> rows = summarise(page.getContent(), viewerId);
        return new PageImpl<>(rows, safe, page.getTotalElements());
    }

    /** Ranks the whole filtered set (aggregates are computed on read) and pages it so page 2 follows page 1. */
    private Page<SocietyResponse> ranked(Specification<Society> spec, String mode, Pageable pageable,
            UUID viewerId) {
        List<Society> all = societies.findAll(spec);
        Tallies tallies = tallies(all.stream().map(Society::getId).toList());
        List<Society> ordered = all.stream()
                .map(s -> {
                    RatingLookup.Rating rating = tallies.rating(s.getId());
                    return new SocietyRanking.Row(s, SocietySpecs.isVerified(s), tallies.homes(s.getId()),
                            rating == null ? null : rating.average(),
                            rating == null ? 0L : rating.reviewCount());
                })
                .sorted(SocietyRanking.by(mode))
                .map(SocietyRanking.Row::society)
                .toList();
        int from = (int) Math.min(pageable.getOffset(), ordered.size());
        int to = Math.min(from + pageable.getPageSize(), ordered.size());
        List<SocietyResponse> rows = summarise(ordered.subList(from, to), viewerId, tallies);
        Pageable echoed = PageRequest.of(
                pageable.getPageNumber(), pageable.getPageSize(), Sort.by(Sort.Direction.DESC, mode));
        return new PageImpl<>(rows, echoed, ordered.size());
    }

    /**
     * Turn a page's worth of societies into cards, in the order given - shared with the follow list
     * so the two cannot drift. Every aggregate covers the whole merge family (societies.md 9.1).
     */
    @Transactional(readOnly = true)
    public List<SocietyResponse> summarise(List<Society> page, UUID viewerId) {
        return summarise(page, viewerId, tallies(page.stream().map(Society::getId).toList()));
    }

    private List<SocietyResponse> summarise(List<Society> page, UUID viewerId, Tallies tallies) {
        List<UUID> reach = page.stream()
                .flatMap(s -> tallies.families().get(s.getId()).stream()).toList();
        Map<UUID, Long> followers = followerCounts(reach);
        Set<UUID> followed = followedBy(viewerId, reach);

        return page.stream().map(society -> {
            List<UUID> family = tallies.families().get(society.getId());
            // Absent, not zero: `forSocieties` omits unrated societies precisely so this stays a
            // null average rather than a 0.0 the card would render as a one-star society.
            RatingLookup.Rating rating = tallies.rating(society.getId());
            return societyMapper.toResponse(
                    society,
                    tallies.homes(society.getId()),
                    sum(followers, family),
                    family.stream().anyMatch(followed::contains),
                    rating == null ? null : rating.average(),
                    rating == null ? 0L : rating.reviewCount());
        }).toList();
    }

    /** The per-society aggregates a card needs, over each one's merge family. */
    private record Tallies(Map<UUID, List<UUID>> families, Map<UUID, Long> listings,
            Map<UUID, RatingLookup.Rating> rated) {

        long homes(UUID id) {
            return sum(listings, families.get(id));
        }

        RatingLookup.Rating rating(UUID id) {
            return combinedRating(rated, families.get(id));
        }
    }

    private Tallies tallies(List<UUID> ids) {
        Map<UUID, List<UUID>> families = families(ids);
        List<UUID> reach = families.values().stream().flatMap(List::stream).toList();
        return new Tallies(families, listingCounts.bySocietyId(), ratings.forSocieties(reach));
    }

    /**
     * One society hub by slug. {@code homes} is capped at {@value #MAX_HOMES}, {@code reviews} stays
     * empty (it is paged elsewhere), and <strong>a merged-away slug resolves rather than 404s</strong>.
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

    /** One query keyed by survivor, survivor-first; per-row would be an N+1 on an unauthenticated endpoint. */
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

    /** A per-society aggregate totalled over the family. Absent keys count as zero. */
    private static long sum(Map<UUID, Long> counts, List<UUID> family) {
        return family.stream().mapToLong(id -> counts.getOrDefault(id, 0L)).sum();
    }

    /** Weighted by review count so a one-review duplicate can't drag the average; null if none published. */
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
