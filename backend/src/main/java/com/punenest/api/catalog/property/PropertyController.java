package com.punenest.api.catalog.property;

import com.punenest.api.catalog.listing.ListingArchiveService;
import com.punenest.api.catalog.listing.ReasonRequest;
import com.punenest.api.common.trust.ContactGate;
import com.punenest.api.common.trust.BackOfficeVisibility;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.trust.OutreachCounts;
import com.punenest.api.common.trust.PrivateFieldVisibility;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
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
 * The public catalogue surface at {@code /properties}: anonymous search, the featured strip, and
 * single-listing detail (contract {@code security: []}), plus the authenticated archive/restore
 * moderation actions on a listing. Thin by design — it binds the request, delegates to the read
 * ({@link PropertyService}) or archive ({@link ListingArchiveService}) service, and maps entities to the
 * contract records at the edge so the JPA entity never crosses the wire.
 *
 * <p>The public reads are opened in {@code SecurityConfig}; the archive/restore {@code PATCH}es stay
 * behind the default-authenticated posture and are authorized (owner-or-staff/admin) in the service.
 */
@RestController
public class PropertyController {

    private final PropertyService propertyService;
    private final ListingArchiveService archiveService;
    private final PropertyMapper propertyMapper;
    private final ContactGate contactGate;
    private final ListingCounts listingCounts;

    public PropertyController(PropertyService propertyService, ListingArchiveService archiveService,
            PropertyMapper propertyMapper, ContactGate contactGate, ListingCounts listingCounts) {
        this.propertyService = propertyService;
        this.archiveService = archiveService;
        this.propertyMapper = propertyMapper;
        this.contactGate = contactGate;
        this.listingCounts = listingCounts;
    }

    /**
     * {@code GET /properties} — faceted public search. Every facet is optional; results are always
     * approved + non-archived (enforced in the service), owner contact is never in the card shape.
     *
     * <p>The listings-page facets arrive as a bound {@link ListingFacets} rather than another
     * twenty-seven {@code @RequestParam} declarations. That is not only brevity: a method with
     * forty parameters is one where a mistyped name binds nothing and the filter silently does
     * not apply, which is precisely the class of bug this whole change exists to remove.
     *
     * <p>{@code rank} is deliberately not part of Spring's {@code sort}: {@code relevance} and
     * {@code newest} are not column orders, they are rankings, and {@link PropertySort} exists to
     * refuse anything that is not a whitelisted column. Passing them through {@code sort} would
     * either widen that whitelist or be silently dropped.
     */
    @GetMapping(Routes.Properties.BASE)
    public PageResponse<PropertySummary> search(
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
        return PageResponse.of(
                propertyService.search(filters, facets, pageable, "newest".equals(rank)),
                propertyMapper::toSummary);
    }

    /** {@code GET /properties/featured} — featured-first live listings for the homepage strip. */
    @GetMapping(Routes.Properties.FEATURED)
    public List<PropertySummary> featured() {
        return propertyService.featured().stream().map(propertyMapper::toSummary).toList();
    }

    /**
     * {@code GET /properties/trust-stats} — the verified share of the live catalogue, or of one
     * locality when {@code locality} is given.
     *
     * <p>Public, and counted by the database. The homepage used to derive these three numbers in the
     * browser from whichever listings it had already loaded, which made every one of them a
     * statement about the current page dressed up as a statement about the catalogue — and the
     * distinct-owner figure was the worst of the three, because two pages of the same owner's flats
     * counted as two verified owners.
     *
     * <p>{@code locality} is a slug, not a display name, and an unknown one answers zeroes rather
     * than {@code 404}: this is a headline about a slice, and an empty slice is a real slice.
     */
    @GetMapping(Routes.Properties.TRUST_STATS)
    public TrustStatsResponse trustStats(@RequestParam(required = false) String locality) {
        return listingCounts.trustStats(locality);
    }

    /**
     * {@code GET /properties/{id}} — single listing detail by slug-or-id. {@code 404} when missing or
     * not publicly visible (non-approved / archived).
     *
     * <p><strong>The contact gate's payoff.</strong> The owner's mobile is masked for everyone except
     * a caller whose gate status for this listing is {@code owner} or {@code approved} — decided by
     * the {@link ContactGate} port, which the contacts feature implements. The route stays public, so
     * {@code principal} is {@code null} for an anonymous reader, and a {@code null} viewer always
     * masks.
     */
    @GetMapping(Routes.Properties.BY_ID)
    public PropertyResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        Property property = propertyService.getPublic(id);
        UUID viewerId = principal != null ? principal.userId() : null;
        UUID ownerId = property.getOwner() != null ? property.getOwner().getId() : null;
        return propertyMapper.toResponse(property,
                contactGate.visibilityFor(viewerId, property.getId(), ownerId),
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.HIDDEN);
    }

    /**
     * {@code PATCH /properties/{id}/archive} — soft-delete a listing (owner or staff/admin). Returns
     * the updated listing; the reason body is optional.
     *
     * <p>Masked contact: this is a moderation response, not a contact surface, and a staff archiver is
     * not a gate-approved counterparty.
     *
     * <p>Private fields are hidden here for the same reason, and hidden <em>even from the owner</em>,
     * which is deliberate rather than an oversight. This route answers "did the archive happen"; the
     * owner reads their own meter number from {@code GET /me/listings/{id}}, which is the surface
     * their edit form is built on. Withholding it on a route that has no use for it costs the owner
     * nothing and keeps the number off one more response body — and the alternative, branching the
     * visibility on whether the caller happens to be the owner, would put a second copy of that
     * decision here to drift out of step with the one in {@code MeListingsController}.
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
