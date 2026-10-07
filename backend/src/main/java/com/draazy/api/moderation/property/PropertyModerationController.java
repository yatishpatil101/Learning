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
import com.draazy.api.moderation.signal.ListingSignalService;
import com.draazy.api.moderation.signal.ListingSignals;
import com.draazy.api.moderation.signal.PropertyModerationResponse;
import com.draazy.api.moderation.verification.PropertyReviewQueue;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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

// Rationale: docs/flows/admin/property-verification.md#moderation-controller.
@RestController
public class PropertyModerationController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String PROPERTIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    // One atom for these actions because the console offers them from the same row.
    private static final String PROPERTIES_MODERATE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_MODERATE;

    // Separate atom because this route lets the caller name another listing owner.
    private static final String POST_ON_BEHALF_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_POSTONBEHALF_WRITE;

    // Verifiers fix what they review without also holding the moderation desk.
    private static final String PROPERTIES_EDIT = STAFF_OR_ADMIN + " and ("
            + BackOfficePermissions.REQUIRE_PROPERTIES_VERIFY + " or "
            + BackOfficePermissions.REQUIRE_PROPERTIES_MODERATE + ")";

    private final PropertyModerationService service;
    private final ListingService listings;
    private final PropertyService propertyService;
    private final PropertyMapper propertyMapper;
    private final OnBehalfListingService onBehalf;
    private final PropertyModerationSummaryRepository summaries;
    private final OwnerOutreachService outreach;
    private final ListingDuplicateClusterService duplicateClusters;
    private final ListingSignalService signals;
    private final PropertyReviewQueue reviewQueue;

    public PropertyModerationController(PropertyModerationService service, ListingService listings,
            PropertyService propertyService, PropertyMapper propertyMapper,
            OnBehalfListingService onBehalf, PropertyModerationSummaryRepository summaries,
            OwnerOutreachService outreach, ListingDuplicateClusterService duplicateClusters,
            ListingSignalService signals, PropertyReviewQueue reviewQueue) {
        this.service = service;
        this.listings = listings;
        this.propertyService = propertyService;
        this.propertyMapper = propertyMapper;
        this.onBehalf = onBehalf;
        this.summaries = summaries;
        this.outreach = outreach;
        this.duplicateClusters = duplicateClusters;
        this.signals = signals;
        this.reviewQueue = reviewQueue;
    }

    // Queue rationale: docs/flows/admin/property-verification.md#moderation-controller.
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES)
    @PreAuthorize(PROPERTIES_READ)
    public PageResponse<PropertyModerationResponse> queue(
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
            @RequestParam(required = false) String progress,
            @RequestParam(required = false) Boolean badge,
            @PageableDefault(size = 20) Pageable pageable) {

        // The owner facet is the public profile page's, deliberately not offered here: the desk
        // already reaches an owner's stock through the user record.
        PropertySearchQuery filters = new PropertySearchQuery(
                deal, type, locality, bhk, minPrice, maxPrice, furnishing, possession, q, status,
                null);
        ModerationFacets mod = new ModerationFacets(
                archived, recheck, featured, postedByAdmin, unconfirmed, progress, badge);
        Page<Property> page = propertyService.searchForModeration(filters, mod, pageable);
        OutreachCounts counts = outreach.countsFor(page.getContent());
        Map<UUID, ListingSignals> pageSignals = signals.forProperties(page.getContent());
        Set<UUID> replied = reviewQueue.awaitingStaff(
                page.getContent().stream().map(Property::getId).toList());
        return PageResponse.of(page,
                p -> new PropertyModerationResponse(
                        propertyMapper.toResponse(p, ContactVisibility.REVEALED,
                                BackOfficeVisibility.VISIBLE, counts, PrivateFieldVisibility.VISIBLE),
                        pageSignals.getOrDefault(p.getId(), ListingSignals.NONE),
                        replied.contains(p.getId())));
    }

    // Unfiltered because it answers "how much is waiting that I am not looking at".
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_SUMMARY)
    @PreAuthorize(PROPERTIES_READ)
    public PropertyModerationSummary summary() {
        return summaries.summary();
    }

    /** {@code PATCH /properties/{id}/status} (contract {@code setPropertyStatus}). */
    @PatchMapping(Routes.Moderation.PROPERTY_STATUS)
    @PreAuthorize(PROPERTIES_MODERATE)
    public void setStatus(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody StatusRequest body) {
        service.setStatus(principal, id, body.status(), body.reason(),
                body.reasonCode(), body.expectedStatus());
    }

    /** {@code POST /properties/{id}/flag} (contract {@code flagProperty}). */
    @PostMapping(Routes.Moderation.PROPERTY_FLAG)
    @PreAuthorize(PROPERTIES_MODERATE)
    public void flag(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ReasonRequest body) {
        service.flag(principal, id, body.reason());
    }

    /** {@code DELETE /properties/{id}/flag} (contract {@code clearFlag}) — 204. */
    @DeleteMapping(Routes.Moderation.PROPERTY_FLAG)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize(PROPERTIES_MODERATE)
    public void clearFlag(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.clearFlag(principal, id);
    }

    // Returns a body because field mapping lives in ListingService.
    @PatchMapping(Routes.Moderation.PROPERTY_ADMIN_UPDATE)
    @PreAuthorize(PROPERTIES_EDIT)
    public PropertyResponse adminUpdate(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody ListingUpdate body) {
        Property updated = listings.updateAsModerator(principal, id, body);
        return propertyMapper.toResponse(updated, ContactVisibility.REVEALED,
                BackOfficeVisibility.VISIBLE, outreach.countsFor(List.of(updated)),
                PrivateFieldVisibility.VISIBLE);
    }

    // Uses POST_ON_BEHALF_WRITE because the caller names somebody else as owner.
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

    // Guarded by the write atom because only the on-behalf desk uses this.
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_OWNER_STANDING)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    public OnBehalfListingService.OwnerListingStanding ownerStanding(@RequestParam String mobile) {
        return onBehalf.standingFor(mobile);
    }

    // A report, not a bare list, so the caller sees when the scan hit its ceiling.
    @GetMapping(Routes.Moderation.ADMIN_PROPERTIES_DUPLICATES)
    @PreAuthorize(PROPERTIES_READ)
    public DuplicateClusterReport duplicates() {
        return duplicateClusters.clusters();
    }

    // Archiving is what PROPERTIES_MODERATE governs everywhere else, so it governs merges too.
    @PostMapping(Routes.Moderation.ADMIN_PROPERTIES_DUPLICATES_MERGE)
    @PreAuthorize(PROPERTIES_MODERATE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void mergeDuplicates(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody DuplicateMergeRequest body) {
        duplicateClusters.resolve(principal, body.keepId(), body.dropIds());
    }

    // Idempotent so double-clicks and second operators return 204, not a unique-index clash.
    @PostMapping(Routes.Moderation.ADMIN_PROPERTIES_DUPLICATES_DISMISS)
    @PreAuthorize(PROPERTIES_MODERATE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismissDuplicate(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody DuplicateDismissRequest body) {
        duplicateClusters.dismiss(principal, body.ids());
    }

    // Send happens on staff's own device, so the server records prepared, not delivered.
    @PostMapping(Routes.Moderation.PROPERTY_OUTREACH)
    @PreAuthorize(POST_ON_BEHALF_WRITE)
    public MessageSender.Prepared chaseOwner(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody OutreachRequest body) {
        return outreach.chase(principal, id, body.templateId());
    }

    // Read atom, not write: colleagues must see when someone already called.
    @GetMapping(Routes.Moderation.PROPERTY_OUTREACH)
    @PreAuthorize(PROPERTIES_READ)
    public List<OwnerOutreachService.OwnerOutreachEntry> outreachHistory(@PathVariable String id) {
        return outreach.history(id);
    }

    public record OutreachRequest(@NotBlank String templateId) {
    }

    public record StatusRequest(@NotBlank String status, String reason,
            String reasonCode, String expectedStatus) {
    }

    public record ReasonRequest(String reason) {
    }
}
