package com.punenest.api.catalog.property;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read side of the catalogue: anonymous search, the featured strip, and single-listing detail. Every
 * method here serves {@code security: []} endpoints, so the public-visibility floor (approved,
 * non-archived) is enforced in the query, never assumed from the caller.
 *
 * <p>Split from {@link com.punenest.api.catalog.listing.ListingService} (the owner write side) on
 * purpose: reads and owner-scoped writes have different auth models and transaction shapes, and a
 * small single-responsibility service is easier to reason about than a god-service.
 */
@Service
public class PropertyService {

    /** Homepage strip cap — the contract's featured endpoint takes no limit, so we bound it here. */
    private static final int FEATURED_CAP = 12;

    private final PropertyRepository properties;

    public PropertyService(PropertyRepository properties) {
        this.properties = properties;
    }

    /**
     * Faceted public search (contract {@code searchProperties}). The specification pins
     * approved+non-archived; the page's sort is sanitized to the whitelist so a client can't sort by
     * (or thereby probe) an unindexed/internal column.
     *
     * <p><strong>Promoted-first on the default order only (D59).</strong> When the caller expressed
     * no preference, paid boosts float to the top via {@link PropertySpecs#boostedFirst}; when the
     * caller chose an order, that order is honoured exactly. The ranked branch hands the repository
     * an <em>unsorted</em> pageable on purpose — a {@code Pageable} sort overrides a
     * specification's {@code ORDER BY}, so leaving the default {@code createdAt DESC} on would
     * silently discard the ranking. {@code boostedFirst} carries that tiebreaker itself instead.
     */
    @Transactional(readOnly = true)
    public Page<Property> search(PropertySearchQuery filters, Pageable pageable) {
        Pageable safe = PropertySort.sanitize(pageable);
        if (PropertySort.hasExplicitSort(pageable)) {
            return properties.findAll(PropertySpecs.publicSearch(filters), safe);
        }
        return properties.findAll(
                PropertySpecs.publicSearch(filters).and(PropertySpecs.boostedFirst(Instant.now())),
                PageRequest.of(safe.getPageNumber(), safe.getPageSize()));
    }

    /**
     * Moderation search (contract {@code listPropertiesForModeration}) — the same facets with
     * <strong>no visibility floor</strong>, so pending, rejected, flagged and archived listings are
     * returned.
     *
     * <p>This is the read that the four moderation writes shipped without. A moderator could set a
     * status, feature, flag or unflag any listing whose id they already held, but nothing on the
     * platform could <em>enumerate</em> the rows needing a decision: {@link #search} is hard-floored
     * to approved, and {@code GET /me/listings} is scoped to the caller's own {@code owner_id}. A
     * verification queue that cannot list its own backlog is a write API with no read.
     *
     * <p><strong>Unauthorized by design.</strong> No principal is taken and no role is checked here —
     * the guard is {@code @PreAuthorize} on the single controller method, matching how the rest of
     * the moderation surface is written. Any new caller of this method is therefore a caller that
     * must carry its own authorization, and the fact that it takes no principal is the reminder.
     */
    @Transactional(readOnly = true)
    public Page<Property> searchForModeration(PropertySearchQuery filters, Boolean archived,
            Pageable pageable) {
        return properties.findAll(
                PropertySpecs.adminSearch(filters, archived), PropertySort.sanitize(pageable));
    }

    /** Featured-first live listings for the homepage (contract {@code featuredProperties}). */
    @Transactional(readOnly = true)
    public List<Property> featured() {
        return properties.findByStatusAndArchivedFalseOrderByFeaturedDescCreatedAtDesc(
                PropertyStatus.APPROVED, PageRequest.of(0, FEATURED_CAP));
    }

    /**
     * Single public listing by slug-or-id (contract {@code getProperty}). Resolves the path token
     * (UUID → id, else slug), then enforces direct-link reachability: a missing, archived, or
     * pending/rejected/flagged row is a {@code 404} — we don't reveal that an unpublished listing
     * exists. A terminal listing (sold/rented, D110) IS reachable here so a buyer holding the link
     * opens the badged page rather than a 404; such rows are already absent from search.
     */
    @Transactional(readOnly = true)
    public Property getPublic(String idOrSlug) {
        Property p = resolve(idOrSlug).filter(Property::isDirectlyReachable)
                .orElseThrow(() -> NotFoundException.of("Property"));
        return p;
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
