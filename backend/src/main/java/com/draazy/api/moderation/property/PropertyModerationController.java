package com.draazy.api.moderation.property;

import com.draazy.api.catalog.listing.ListingService;
import com.draazy.api.catalog.listing.ListingUpdate;
import com.draazy.api.catalog.property.ModerationFacets;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyResponse;
import com.draazy.api.catalog.property.PropertySearchQuery;
import com.draazy.api.catalog.property.PropertyService;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.MessageSender;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.trust.PrivateFieldVisibility;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.moderation.duplicate.DuplicateClusterReport;
import com.draazy.api.moderation.duplicate.DuplicateDismissRequest;
import com.draazy.api.moderation.duplicate.DuplicateMergeRequest;
import com.draazy.api.moderation.duplicate.ListingDuplicateClusterService;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Listing moderation endpoints (contract tag {@code Moderation}).
 * Rationale: docs/flows/admin/property-verification.md#moderation-controller.
 */
@RestController
public class PropertyModerationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    /** Seeing the queue. */
    private static final String PROPERTIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    /**
     * Acting on a listing — approve, reject, feature, flag, correct. One atom for all five: the
     * console offers them from the same table row, so a finer split would describe no real screen.
     */
    private static final String PROPERTIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE;

    /**
     * Creating a listing owned by somebody else. Its own atom, not {@link #PROPERTIES_WRITE}: the
     * only route where the caller names the owner of what they create.
     */
    private static final String POST_ON_BEHALF_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_POSTONBEHALF_WRITE;

    private final PropertyModerationService service;
    private final ListingService listings;
    private final PropertyService propertyService;
    private final PropertyMapper propertyMapper;
    private final OnBehalfListingService onBehalf;
    private final PropertyModerationSummaryRepository summaries;
    private final OwnerOutreachService outreach;
    private final ListingDuplicateClusterService duplicateClusters;

    public PropertyModerationController(PropertyModerationService service, ListingService listings,
            PropertyService propertyService, PropertyMapper propertyMapper,
            OnBehalfListingService onBehalf, PropertyModerationSummaryRepository summaries,
            OwnerOutreachService outreach, ListingDuplicateClusterService duplicateClusters) {
        this.service = service;
        this.listings = listings;
        this.propertyService = propertyService;
        this.propertyMapper = propertyMapper;
        this.onBehalf = onBehalf;
        this.summaries = summaries;
        this.outreach = outreach;
        this.duplicateClusters = duplicateClusters;
    }

    /**
     * {@code GET /admin/properties} (contract {@code listPropertiesForModeration}) — the queue.
     * Rationale: docs/flows/admin/property-verification.md#moderation-controller.
     */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES)
    @PreAuthorize(PROPERTIES_READ)
    public PageResponse<PropertyResponse> queue(
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
            @RequestParam(required = false) Boolean archived,
            @RequestParam(required = false) Boolean recheck,
            @RequestParam(required = false) Boolean featured,
            @RequestParam(required = false) Boolean postedByAdmin,
            @RequestParam(required = false) Boolean unconfirmed,
            @PageableDefault(size = 20) Pageable pageable) {
        // The owner facet is the public profile page's, deliberately not offered here: the desk
        // already reaches an owner's stock through the user record.
        PropertySearchQuery filters = new PropertySearchQuery(
                deal, type, locality, bhk, minPrice, maxPrice, furnishing, possession, q, status,
                null);
        ModerationFacets mod =
                new ModerationFacets(archived, recheck, featured, postedByAdmin, unconfirmed);
        Page<Property> page = propertyService.searchForModeration(filters, mod, pageable);
        OutreachCounts counts = outreach.countsFor(page.getContent());
        return PageResponse.of(page,
                p -> propertyMapper.toResponse(p, ContactVisibility.REVEALED,
                        BackOfficeVisibility.VISIBLE, counts, PrivateFieldVisibility.VISIBLE));
    }

    /**
     * {@code GET /admin/properties/summary} — platform-wide headline counts. Unfiltered on purpose:
     * "how much is waiting that I am not looking at" is what a filtered count cannot answer.
     */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_SUMMARY)
    @PreAuthorize(PROPERTIES_READ)
    public PropertyModerationSummary summary() {
        return summaries.summary();
    }

    /** {@code PATCH /properties/{id}/status} (contract {@code setPropertyStatus}). */
    @PatchMapping(Routes.Moderation.PROPERTY_STATUS)
    @PreAuthorize(PROPERTIES_WRITE)
    public void setStatus(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody StatusRequest body) {
        service.setStatus(principal, id, body.status(), body.reason());
    }

    /** {@code POST /properties/{id}/toggle-featured} (contract {@code toggleFeatured}). */
    @PostMapping(Routes.Moderation.PROPERTY_FEATURED)
    @PreAuthorize(PROPERTIES_WRITE)
    public void toggleFeatured(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.toggleFeatured(principal, id);
    }

    /** {@code POST /properties/{id}/flag} (contract {@code flagProperty}). */
    @PostMapping(Routes.Moderation.PROPERTY_FLAG)
    @PreAuthorize(PROPERTIES_WRITE)
    public void flag(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ReasonRequest body) {
        service.flag(principal, id, body.reason());
    }

    /** {@code DELETE /properties/{id}/flag} (contract {@code clearFlag}) — 204. */
    @DeleteMapping(Routes.Moderation.PROPERTY_FLAG)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize(PROPERTIES_WRITE)
    public void clearFlag(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.clearFlag(principal, id);
    }

    /**
     * {@code PATCH /properties/{id}/admin} — correct another user's listing in place. The one
     * moderation route returning a body; field mapping lives in {@link ListingService}.
     */
    @PatchMapping(Routes.Moderation.PROPERTY_ADMIN_UPDATE)
    @PreAuthorize(PROPERTIES_WRITE)
    public PropertyResponse adminUpdate(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody ListingUpdate body) {
        Property updated = listings.updateAsModerator(principal, id, body);
        return propertyMapper.toResponse(updated, ContactVisibility.REVEALED,
                BackOfficeVisibility.VISIBLE, outreach.countsFor(List.of(updated)),
                PrivateFieldVisibility.VISIBLE);
    }

    /**
     * {@code POST /admin/properties} — post a listing on an owner's behalf; 201. Carries
     * {@link #POST_ON_BEHALF_WRITE} because the caller names somebody else as owner.
     */
    @PostMapping(Routes.Moderation.ADMIN_PROPERTIES)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyResponse createOnBehalf(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody OnBehalfListingRequest body) {
        // NONE rather than a lookup: the listing did not exist a moment ago, so nobody can have
        // chased its owner about it. Querying would be a round trip guaranteed to return zero.
        return propertyMapper.toResponse(onBehalf.create(principal, body), ContactVisibility.REVEALED,
                BackOfficeVisibility.VISIBLE, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    /**
     * {@code GET /admin/properties/owner-standing} — this owner's listing-ceiling usage; 200 even
     * for a number with no account. Guarded by the write atom: its only audience is that desk.
     */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_OWNER_STANDING)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    public OnBehalfListingService.OwnerListingStanding ownerStanding(@RequestParam String mobile) {
        return onBehalf.standingFor(mobile);
    }

    /**
     * {@code GET /admin/properties/duplicates} — listings that look like the same doorway, grouped.
     * A report, not a bare list, so the caller is told when the scan hit its ceiling.
     */
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_DUPLICATES)
    @PreAuthorize(PROPERTIES_READ)
    public DuplicateClusterReport duplicates() {
        return duplicateClusters.clusters();
    }

    /**
     * {@code POST /admin/properties/duplicates/merge} — keep one, archive the rest; 204. Archiving
     * is what {@link #PROPERTIES_WRITE} governs everywhere else, so it governs here too.
     */
    @PostMapping(Routes.Moderation.ADMIN_PROPERTIES_DUPLICATES_MERGE)
    @PreAuthorize(PROPERTIES_WRITE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void mergeDuplicates(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody DuplicateMergeRequest body) {
        duplicateClusters.resolve(principal, body.keepId(), body.dropIds());
    }

    /**
     * {@code POST /admin/properties/duplicates/dismiss} — record that a cluster is a coincidence;
     * 204. Idempotent so a double-click or a second operator returns 204, not a unique-index clash.
     */
    @PostMapping(Routes.Moderation.ADMIN_PROPERTIES_DUPLICATES_DISMISS)
    @PreAuthorize(PROPERTIES_WRITE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismissDuplicate(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody DuplicateDismissRequest body) {
        duplicateClusters.dismiss(principal, body.ids());
    }

    /**
     * {@code POST /properties/{id}/pipeline} — move a staff-posted listing along the owner hand-back
     * funnel. {@link #POST_ON_BEHALF_WRITE}: the funnel only exists for listings that route created.
     */
    @PostMapping(Routes.Moderation.PROPERTY_PIPELINE)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    public PropertyResponse advancePipeline(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody PipelineRequest body) {
        Property moved = onBehalf.advance(principal, id, body.stage());
        return propertyMapper.toResponse(moved, ContactVisibility.REVEALED,
                BackOfficeVisibility.VISIBLE, outreach.countsFor(List.of(moved)),
                PrivateFieldVisibility.VISIBLE);
    }

    /** Body of {@code advancePropertyPipeline}. */
    public record PipelineRequest(@NotBlank String stage) {
    }

    /**
     * {@code POST /properties/{id}/outreach} — chase this listing's owner. The send happens on the
     * staff member's own device, so the server records {@code prepared}, not a delivery.
     */
    @PostMapping(Routes.Moderation.PROPERTY_OUTREACH)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    public MessageSender.Prepared chaseOwner(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody OutreachRequest body) {
        return outreach.chase(principal, id, body.templateId());
    }

    /**
     * {@code GET /properties/{id}/outreach} — every chaser sent to this listing's owner. Read atom,
     * not write: the colleague who should back off must be able to see somebody already called.
     */
    @GetMapping(Routes.Moderation.PROPERTY_OUTREACH)
    @PreAuthorize(PROPERTIES_READ)
    public List<OwnerOutreachService.OwnerOutreachEntry> outreachHistory(@PathVariable String id) {
        return outreach.history(id);
    }

    /** Body of {@code sendOwnerOutreach}. */
    public record OutreachRequest(@NotBlank String templateId) {
    }

    @PostMapping("/properties/{id}/outreach/{messageId}/sent")
    @PreAuthorize("hasAnyRole('STAFF', 'ADMIN') and " + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE
            + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void recordClaimLinkSent(@CurrentUser AuthPrincipal actor, @PathVariable String id,
            @PathVariable String messageId) {
        outreach.recordClaimLinkSent(actor, id, messageId);
    }

    /** Body of {@code setPropertyStatus} (schema {@code PropertyStatusUpdate}). */
    public record StatusRequest(@NotBlank String status, String reason) {    }    /** Body of {@code flagProperty} (schema {@code ReasonRequest}). */
    public record ReasonRequest(String reason) {
    }
}
