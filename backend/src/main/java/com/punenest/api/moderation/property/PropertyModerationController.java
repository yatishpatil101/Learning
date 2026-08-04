package com.punenest.api.moderation.property;

import com.punenest.api.catalog.listing.ListingService;
import com.punenest.api.catalog.listing.ListingUpdate;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyResponse;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Listing moderation endpoints (contract tag {@code Moderation}).
 *
 * <p>The four moderator-only routes carry {@code @PreAuthorize} matching the {@code x-roles} the
 * contract gained in spec fix S28. {@code archive}/{@code restore} deliberately do not: they are
 * dual-audience (owner <em>or</em> staff) and their guard lives in the service, because
 * {@code @PreAuthorize} can express "is staff" but not "is staff or owns this row".
 *
 * <p>The status routes carry no response body. That is the contract's choice, not an omission —
 * {@code setPropertyStatus}, {@code toggleFeatured}, {@code flagProperty}, {@code archiveProperty}
 * and {@code restoreProperty} all declare a bare {@code '200': { description: ... }} with no schema.
 * The admin UI re-reads the listing after acting. {@code adminUpdateProperty} is the exception: it
 * returns the listing, because it is the only one whose effect the caller cannot predict from the
 * request they sent.
 *
 * <p><strong>{@code adminUpdateProperty} maps here but does its work in
 * {@code catalog.listing.ListingService}.</strong> Its body is {@code ListingUpdate}, i.e. all of
 * {@code ListingCreate} made optional, and the owner-facing update already applies exactly that
 * mapping. Rebuilding it here would guarantee two copies that drift, so the two paths share one
 * private {@code apply} and differ only in what they do afterwards — an owner's edit re-opens
 * moderation, a moderator's does not (slice 15).
 *
 * <p><strong>Also not here:</strong> {@code archive}/{@code restore}. They already ship in
 * {@code catalog.property.PropertyController}, authorized owner-or-staff in the service — which is
 * the dual-audience rule spec fix S28 recorded, already correctly implemented in slice 2.
 */
@RestController
public class PropertyModerationController {

    private final PropertyModerationService service;
    private final ListingService listings;
    private final PropertyMapper propertyMapper;

    public PropertyModerationController(PropertyModerationService service, ListingService listings,
            PropertyMapper propertyMapper) {
        this.service = service;
        this.listings = listings;
        this.propertyMapper = propertyMapper;
    }

    /** {@code PATCH /properties/{id}/status} (contract {@code setPropertyStatus}). */
    @PatchMapping(Routes.Moderation.PROPERTY_STATUS)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public void setStatus(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody StatusRequest body) {
        service.setStatus(principal, id, body.status(), body.reason());
    }

    /** {@code POST /properties/{id}/toggle-featured} (contract {@code toggleFeatured}). */
    @PostMapping(Routes.Moderation.PROPERTY_FEATURED)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public void toggleFeatured(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.toggleFeatured(principal, id);
    }

    /** {@code POST /properties/{id}/flag} (contract {@code flagProperty}). */
    @PostMapping(Routes.Moderation.PROPERTY_FLAG)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public void flag(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ReasonRequest body) {
        service.flag(principal, id, body.reason());
    }

    /** {@code DELETE /properties/{id}/flag} (contract {@code clearFlag}) — 204. */
    @DeleteMapping(Routes.Moderation.PROPERTY_FLAG)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public void clearFlag(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.clearFlag(principal, id);
    }

    /**
     * {@code PATCH /properties/{id}/admin} (contract {@code adminUpdateProperty}) — correct another
     * user's listing in place.
     *
     * <p>The one moderation route that returns a body, because it is the one that changes fields
     * the moderator chose rather than a status they can already see. Rendered
     * {@link ContactVisibility#MASKED}: an ops screen has no need of the owner's raw number, and
     * {@code GET /properties/{id}} stays the only endpoint that emits one.
     *
     * <p>The work is delegated to {@link ListingService#updateAsModerator}, which owns the single
     * copy of the {@code ListingUpdate} field mapping — see this class's Javadoc.
     */
    @PatchMapping(Routes.Moderation.PROPERTY_ADMIN_UPDATE)
    @PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
    public PropertyResponse adminUpdate(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @Valid @RequestBody ListingUpdate body) {
        return propertyMapper.toResponse(
                listings.updateAsModerator(principal, id, body), ContactVisibility.MASKED);
    }

    /** Body of {@code setPropertyStatus} (schema {@code PropertyStatusUpdate}). */
    public record StatusRequest(@NotBlank String status, String reason) {
    }
    /** Body of {@code flagProperty} (schema {@code ReasonRequest}). */
    public record ReasonRequest(String reason) {
    }
}
