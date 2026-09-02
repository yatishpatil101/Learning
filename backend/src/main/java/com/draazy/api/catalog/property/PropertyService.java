package com.draazy.api.catalog.property;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read side of the catalogue: anonymous search, the featured strip, and single-listing detail. Every
 * method here serves {@code security: []} endpoints, so the public-visibility floor (approved,
 * non-archived) is enforced in the query, never assumed from the caller.
 *
 * <p>Split from {@link com.draazy.api.catalog.listing.ListingService} (the owner write side) on
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
        return search(filters, ListingFacets.NONE, pageable, false);
    }

    /**
     * Faceted public search including the listings-page facets and ranking (D26).
     *
     * @param filters   the contract facets
     * @param extra     the listings-page facets, or {@link ListingFacets#NONE}
     * @param pageable  page, size and optional explicit sort
     * @param newestOnly when the caller asked for "newest" specifically: promoted-first then most
     *     recent, with no merit ranking. The distinction matters because "newest" and "best match"
     *     are the two orders that both carry paid placement, and only one of them may be reordered
     *     by a quality score — a buyer who asked for the newest listings and got the best-scoring
     *     ones instead has been shown something other than what the control says.
     */
    @Transactional(readOnly = true)
    public Page<Property> search(PropertySearchQuery filters, ListingFacets extra, Pageable pageable,
            boolean newestOnly) {
        Pageable safe = PropertySort.sanitize(pageable);
        if (PropertySort.hasExplicitSort(pageable)) {
            return properties.findAll(PropertySpecs.publicSearch(filters, extra), safe);
        }
        Instant now = Instant.now();
        Specification<Property> ranked = newestOnly
                ? PropertySpecs.boostedFirst(now)
                : PropertySpecs.relevanceFirst(now);
        return properties.findAll(
                PropertySpecs.publicSearch(filters, extra).and(ranked),
                PageRequest.of(safe.getPageNumber(), safe.getPageSize()));
    }

    /**
     * How many of the listings matching this search carry a trust badge (contract
     * {@code searchProperties.verifiedElements}).
     *
     * <p>Counted by the database over the <em>whole</em> match, not the page. The listings header
     * reads "N properties · M verified", and while the browser held the entire catalogue both
     * numbers were about the same set. Server-side paging breaks that: M computed from the rows in
     * hand would silently become "verified on this page" while sitting next to a total that still
     * means the catalogue — the same class of claim {@code trustStats} exists to stop the homepage
     * making. Cheap to answer, because it reuses the search specification and reads no rows.
     *
     * <p>Ranking is deliberately not applied. It cannot change a count, and {@code relevanceFirst}
     * builds an {@code ORDER BY} that a {@code COUNT} query has no use for.
     */
    @Transactional(readOnly = true)
    public long countVerified(PropertySearchQuery filters, ListingFacets extra) {
        return properties.count(
                PropertySpecs.publicSearch(filters, extra).and(PropertySpecs.anyVerified(Instant.now())));
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
