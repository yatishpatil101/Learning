package com.draazy.api.catalog.property;

import com.draazy.api.catalog.listing.ListingArchiveService;
import com.draazy.api.catalog.listing.ReasonRequest;
import com.draazy.api.common.trust.ContactGate;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.trust.PrivateFieldVisibility;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The public catalogue surface at {@code /properties} plus the authenticated archive/restore actions,
 * which are authorized in the service. Thin by design: bind, delegate, map to contract records.
 */
@RestController
public class PropertyController {

    private final PropertyService propertyService;
    private final ListingArchiveService archiveService;
    private final PropertyMapper propertyMapper;
    private final ContactGate contactGate;
    private final ListingCounts listingCounts;
    private final AccountPermissions permissions;

    public PropertyController(PropertyService propertyService, ListingArchiveService archiveService,
            PropertyMapper propertyMapper, ContactGate contactGate, ListingCounts listingCounts,
            AccountPermissions permissions) {
        this.propertyService = propertyService;
        this.archiveService = archiveService;
        this.propertyMapper = propertyMapper;
        this.contactGate = contactGate;
        this.listingCounts = listingCounts;
        this.permissions = permissions;
    }

    /**
     * {@code GET /properties} - faceted public search; the visibility floor is enforced in the service.
     * Facet binding and why {@code rank} is not a {@code sort}: search-listings.md section 9.7.
     */
    @GetMapping(Routes.Properties.BASE)
    public PropertySearchResponse<PropertySummary> search(
            @RequestParam(required = false) String deal,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String locality,
            @RequestParam(required = false) Integer bhk,
            @RequestParam(required = false) Long minPrice,
            @RequestParam(required = false) Long maxPrice,
            @RequestParam(required = false) String furnishing,
            @RequestParam(required = false) String possession,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String owner,
            @RequestParam(required = false) String rank,
            @ModelAttribute ListingFacets facets,
            @PageableDefault(size = 20) Pageable pageable) {
        PropertySearchQuery filters = new PropertySearchQuery(
                deal, type, locality, bhk, minPrice, maxPrice, furnishing, possession, q, status,
                owner);
        PropertyService.SearchResult result =
                propertyService.searchWithTotals(filters, facets, pageable, "newest".equals(rank));
        return PropertySearchResponse.of(
                PageResponse.of(result.page(), propertyMapper::toSummary), result.verifiedTotal());
    }

    /** {@code GET /properties/featured} — featured-first live listings for the homepage strip. */
    @GetMapping(Routes.Properties.FEATURED)
    public List<PropertySummary> featured() {
        return propertyService.featured().stream().map(propertyMapper::toSummary).toList();
    }

    /**
     * {@code GET /properties/trust-stats} - the verified share of the live catalogue, counted by the
     * database rather than the browser: docs/flows/consumer/search-listings.md section 9.8.
     */
    @GetMapping(Routes.Properties.TRUST_STATS)
    public TrustStatsResponse trustStats(@RequestParam(required = false) String locality) {
        return listingCounts.trustStats(locality);
    }

    /**
     * {@code GET /properties/{id}} - single listing detail by slug-or-id; {@code 404} when missing or
     * not publicly visible, except to the owner and to a checker. A {@code null} viewer masks the contact.
     */
    @GetMapping(Routes.Properties.BY_ID)
    public PropertyResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        UUID viewerId = principal != null ? principal.userId() : null;
        Property property = propertyService.getPublic(id, viewerId, mayPreview(principal));
        UUID ownerId = property.getOwner() != null ? property.getOwner().getId() : null;
        return propertyMapper.toResponse(property,
                contactGate.visibilityFor(viewerId, property.getId(), ownerId),
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.HIDDEN);
    }

    /**
     * Whether this caller may open a listing the public cannot. The grant and not the bare role: a
     * moderator whose {@code properties:read} has been revoked has had this door closed too.
     */
    private boolean mayPreview(AuthPrincipal principal) {
        return principal != null
                && (Roles.Wire.STAFF.equals(principal.role()) || Roles.Wire.ADMIN.equals(principal.role()))
                && permissions.granted(principal, BackOfficePermissions.PROPERTIES_READ);
    }

    /**
     * {@code PATCH /properties/{id}/archive} - soft-delete a listing (owner or staff/admin). Contact
     * masked and private fields hidden even from the owner: search-listings.md section 9.8.
     */
    @PatchMapping(Routes.Properties.ARCHIVE)
    public PropertyResponse archive(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonRequest body) {
        String reason = body != null ? body.reason() : null;
        return propertyMapper.toResponse(
                archiveService.archive(principal, id, reason), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.HIDDEN);
    }

    /**
     * {@code PATCH /properties/{id}/restore} — un-archive a listing (owner or staff/admin); status is
     * reset to {@code pending} for re-moderation. Masked contact, as for archive.
     */
    @PatchMapping(Routes.Properties.RESTORE)
    public PropertyResponse restore(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                archiveService.restore(principal, id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.HIDDEN);
    }
}
