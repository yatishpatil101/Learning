package com.draazy.api.catalog.property;

import com.draazy.api.catalog.locality.LocalityRepository;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Every method serves {@code security: []}, so the approved + non-archived floor is enforced in the query. */
@Service
public class PropertyService {

    /** The home strip draws six; the contract's featured endpoint takes no limit, so we bound it here. */
    private static final int FEATURED_CAP = 6;

    /** A rail of recently viewed listings never holds more than this. */
    public static final int CARDS_CAP = 16;

    // ponytail: newest 100 only, so counts undercount once live stock outgrows it; aggregate server-side then.
    private static final int SEARCH_INDEX_CAP = 100;

    private static final int REELS_CAP = 24;

    private static final PropertySearchQuery NO_FILTERS =
            new PropertySearchQuery(null, null, null, null, null, null, null, null, null, null, null);

    private final PropertyRepository properties;
    private final LocalityRepository localities;

    public PropertyService(PropertyRepository properties, LocalityRepository localities) {
        this.properties = properties;
        this.localities = localities;
    }

    @Transactional(readOnly = true)
    public SearchResult searchWithTotals(PropertySearchQuery filters, ListingFacets extra,
            Pageable pageable, PropertySort.Rank rank) {
        Pageable safe = PropertySort.sanitize(pageable);
        Specification<Property> match = PropertySpecs.publicSearch(filters, extra, localityCenter(filters.locality()));
        Instant now = Instant.now();

        Specification<Property> ordered;
        Pageable exec;
        if (PropertySort.hasExplicitSort(pageable)) {
            ordered = match;
            exec = safe;
        } else {
            ordered = match.and(switch (rank) {
                case NEWEST -> PropertySpecs.newestFirst();
                case PRICE_PER_SQFT -> PropertySpecs.pricePerSqftFirst();
                case VERIFIED -> PropertySpecs.verifiedFirst(now);
                case RELEVANCE -> PropertySpecs.relevanceFirst(now);
            });
            exec = PageRequest.of(safe.getPageNumber(), safe.getPageSize());
        }

        List<Property> rows = properties.findPage(ordered, exec);
        PropertySearchFragment.Totals totals = properties.countTotals(
                match, PropertySpecs.anyVerified(now), PropertySpecs.unstatedFiltered(extra));

        // `exec`, not `safe` — the page must carry the pageable its rows were actually read with, or
        // a client reading `sort` off the response would be told about an order that was overridden.
        return new SearchResult(new PageImpl<>(rows, exec, totals.total()), totals.verified(),
                totals.unstated());
    }

    /** Null for a blank or unknown slug, or a locality with no pin: those match on the slug alone. */
    PropertySpecs.LocalityPoint localityCenter(String slug) {
        if (slug == null || slug.isBlank()) {
            return null;
        }
        return localities.findById(slug)
                .filter(l -> l.getLat() != null && l.getLng() != null)
                .map(l -> new PropertySpecs.LocalityPoint(l.getLat(), l.getLng()))
                .orElse(null);
    }

    /** The two counts describe the whole match, not the page, so neither fits in a {@link Page}. */
    public record SearchResult(Page<Property> page, long verifiedTotal, long unstatedTotal) {
    }

    /** No visibility floor, only {@code @PreAuthorize} on its one caller, so a new one needs its own. */
    @Transactional(readOnly = true)
    public Page<Property> searchForModeration(PropertySearchQuery filters, ModerationFacets mod,
            Pageable pageable) {
        return properties.findAll(PropertySpecs.adminSearch(filters, mod),
                PropertySort.sanitizeModeration(pageable));
    }

    @Transactional(readOnly = true)
    public List<Property> featured() {
        return properties.findByStatusAndArchivedFalseOrderByFeaturedDescCreatedAtDesc(
                PropertyStatus.APPROVED, PageRequest.of(0, FEATURED_CAP));
    }

    /** The publicly live rows among {@code ids} (slugs or UUIDs), in no particular order. */
    @Transactional(readOnly = true)
    public List<Property> publicByIds(List<String> ids) {
        return properties.findPage(PropertySpecs.publicSearch(NO_FILTERS, ListingFacets.ofIds(ids)),
                PageRequest.of(0, CARDS_CAP));
    }

    @Transactional(readOnly = true)
    public List<Property> newestReels(ListingFacets facets) {
        return properties.findPage(PropertySpecs.publicSearch(NO_FILTERS, facets).and(PropertySpecs.newestFirst()),
                PageRequest.of(0, REELS_CAP));
    }

    @Transactional(readOnly = true)
    public List<Property> newestLive() {
        return properties.findPage(PropertySpecs.publicSearch(NO_FILTERS).and(PropertySpecs.newestFirst()),
                PageRequest.of(0, SEARCH_INDEX_CAP));
    }

    @Transactional(readOnly = true)
    public Property getPublic(String idOrSlug, UUID viewerId, boolean staff) {
        Property p = resolve(idOrSlug).orElseThrow(() -> NotFoundException.of("Property"));
        if (!p.isDirectlyReachable() && !isOwnedBy(p, viewerId) && !(staff && !p.isArchived())) {
            throw NotFoundException.of("Property");
        }
        return p;
    }

    /** A signed-in viewer owning a listing that has not been taken down. */
    private static boolean isOwnedBy(Property p, UUID viewerId) {
        return viewerId != null && !p.isArchived() && p.getOwner() != null
                && viewerId.equals(p.getOwner().getId());
    }

    private Optional<Property> resolve(String idOrSlug) {
        UUID id = tryUuid(idOrSlug);
        return id != null ? properties.findById(id) : properties.findBySlug(idOrSlug);
    }

    /** {@code null} when the token isn't a UUID — the signal to fall back to a slug lookup. */
    static UUID tryUuid(String token) {
        return Ids.parseUuid(token).orElse(null);
    }
}
