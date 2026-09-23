package com.draazy.api.catalog.property;

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

    /** Homepage strip cap — the contract's featured endpoint takes no limit, so we bound it here. */
    private static final int FEATURED_CAP = 12;

    private final PropertyRepository properties;

    public PropertyService(PropertyRepository properties) {
        this.properties = properties;
    }

    /** Ranking and {@code newestOnly}: search-listings.md sections 9.3, 9.7. */
    @Transactional(readOnly = true)
    public SearchResult searchWithTotals(PropertySearchQuery filters, ListingFacets extra,
            Pageable pageable, boolean newestOnly) {
        Pageable safe = PropertySort.sanitize(pageable);
        Specification<Property> match = PropertySpecs.publicSearch(filters, extra);
        Instant now = Instant.now();

        Specification<Property> ordered;
        Pageable exec;
        if (PropertySort.hasExplicitSort(pageable)) {
            ordered = match;
            exec = safe;
        } else {
            ordered = match.and(newestOnly ? PropertySpecs.boostedFirst(now) : PropertySpecs.relevanceFirst(now));
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

    /** The two counts describe the whole match, not the page, so neither fits in a {@link Page}. */
    public record SearchResult(Page<Property> page, long verifiedTotal, long unstatedTotal) {
    }

    /** <strong>No visibility floor</strong>, guarded only by {@code @PreAuthorize} on its single caller; a new caller must carry its own. */
    @Transactional(readOnly = true)
    public Page<Property> searchForModeration(PropertySearchQuery filters, ModerationFacets mod,
            Pageable pageable) {
        return properties.findAll(PropertySpecs.adminSearch(filters, mod),
                PropertySort.sanitize(pageable));
    }

    /** Featured-first live listings for the homepage (contract {@code featuredProperties}). */
    @Transactional(readOnly = true)
    public List<Property> featured() {
        return properties.findByStatusAndArchivedFalseOrderByFeaturedDescCreatedAtDesc(
                PropertyStatus.APPROVED, PageRequest.of(0, FEATURED_CAP));
    }

    /** Missing, archived or unapproved is a {@code 404}, except for the owner and a checker. */
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

    /** Resolve a path token to a listing: parse as UUID → by id; otherwise treat as a slug. */
    private Optional<Property> resolve(String idOrSlug) {
        UUID id = tryUuid(idOrSlug);
        return id != null ? properties.findById(id) : properties.findBySlug(idOrSlug);
    }

    /** {@code null} when the token isn't a UUID — the signal to fall back to a slug lookup. */
    static UUID tryUuid(String token) {
        return Ids.parseUuid(token).orElse(null);
    }
}
