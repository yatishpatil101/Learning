package com.punenest.api.catalog.property;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
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
     */
    @Transactional(readOnly = true)
    public Page<Property> search(PropertySearchQuery filters, Pageable pageable) {
        return properties.findAll(PropertySpecs.publicSearch(filters), PropertySort.sanitize(pageable));
    }

    /** Featured-first live listings for the homepage (contract {@code featuredProperties}). */
    @Transactional(readOnly = true)
    public List<Property> featured() {
        return properties.findByStatusAndArchivedFalseOrderByFeaturedDescCreatedAtDesc(
                PropertyStatus.APPROVED, PageRequest.of(0, FEATURED_CAP));
    }

    /**
     * Single public listing by slug-or-id (contract {@code getProperty}). Resolves the path token
     * (UUID → id, else slug), then enforces public visibility: a missing, archived, or non-approved
     * row is a {@code 404} — we don't reveal that an unpublished listing exists.
     */
    @Transactional(readOnly = true)
    public Property getPublic(String idOrSlug) {
        Property p = resolve(idOrSlug).filter(Property::isPubliclyVisible)
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
