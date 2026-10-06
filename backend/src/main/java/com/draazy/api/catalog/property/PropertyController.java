package com.draazy.api.catalog.property;

import com.draazy.api.catalog.listing.ListingArchiveService;
import com.draazy.api.catalog.listing.ReasonRequest;
import com.draazy.api.common.trust.ContactGate;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.FlagReasonVisibility;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.trust.PrivateFieldVisibility;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.constraints.Size;
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

@RestController
public class PropertyController {

    private final PropertyService propertyService;
    private final ListingArchiveService archiveService;
    private final PropertyMapper propertyMapper;
    private final ContactGate contactGate;
    private final AccountPermissions permissions;

    public PropertyController(PropertyService propertyService, ListingArchiveService archiveService,
            PropertyMapper propertyMapper, ContactGate contactGate, AccountPermissions permissions) {
        this.propertyService = propertyService;
        this.archiveService = archiveService;
        this.propertyMapper = propertyMapper;
        this.contactGate = contactGate;
        this.permissions = permissions;
    }

    /** Facet binding and why {@code rank} is not a {@code sort}: search-listings.md section 9.7. */
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
            @RequestParam(required = false) @Size(max = 120) String q,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String owner,
            @RequestParam(required = false) String rank,
            @ModelAttribute ListingFacets facets,
            @PageableDefault(size = 20) Pageable pageable) {
        PropertySearchQuery filters = new PropertySearchQuery(
                deal, type, locality, bhk, minPrice, maxPrice, furnishing, possession, q, status,
                owner);
        PropertyService.SearchResult result =
                propertyService.searchWithTotals(filters, facets, pageable, PropertySort.rank(rank));
        return PropertySearchResponse.of(
                PageResponse.of(result.page(), propertyMapper::toSummary), result.verifiedTotal(),
                result.unstatedTotal());
    }

    @GetMapping(Routes.Properties.FEATURED)
    public List<PropertySummary> featured() {
        return propertyService.featured().stream().map(propertyMapper::toSummary).toList();
    }

    /** {@code 404} when not publicly visible, except to the owner and a checker; a {@code null} viewer masks the contact. */
    @GetMapping(Routes.Properties.BY_ID)
    public PropertyResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        UUID viewerId = principal != null ? principal.userId() : null;
        Property property = propertyService.getPublic(id, viewerId, mayPreview(principal));
        UUID ownerId = property.getOwner() != null ? property.getOwner().getId() : null;
        return propertyMapper.toResponse(property,
                contactGate.visibilityFor(viewerId, property.getId(), ownerId),
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.HIDDEN,
                mayPreview(principal) ? FlagReasonVisibility.VISIBLE : FlagReasonVisibility.HIDDEN);
    }

    /** The grant and not the bare role: a moderator whose {@code properties:read} was revoked loses this door too. */
    private boolean mayPreview(AuthPrincipal principal) {
        return principal != null
                && Roles.isBackOffice(principal.role())
                && permissions.granted(principal, BackOfficePermissions.PROPERTIES_READ);
    }

    @PatchMapping(Routes.Properties.ARCHIVE)
    public PropertyResponse archive(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonRequest body) {
        String reason = body != null ? body.reason() : null;
        return propertyMapper.toResponse(
                archiveService.archive(principal, id, reason), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.HIDDEN);
    }

    @PatchMapping(Routes.Properties.RESTORE)
    public PropertyResponse restore(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                archiveService.restore(principal, id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.HIDDEN);
    }
}
