package com.draazy.api.catalog.locality;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/locality-queue} — the listings the catalogue cannot file, and the fix for one.
 *
 * <p><strong>Gated on {@code properties:*}, not {@code localities:*}, and the choice is load-
 * bearing.</strong> Every row here is a listing and the only write is to a listing's
 * {@code locality_slug}, so the permission that governs it is the one that governs listings. That
 * also settles a question the alternative could not: {@code PropertyModerationService} now refuses
 * to approve a listing with no locality, and a moderator who could be stopped by that rule but not
 * permitted to clear it would be stuck with no route out of the deadlock. Whoever holds
 * {@code properties:write} holds both the block and its remedy.
 *
 * <p>A separate controller from {@link LocalityAdminController} for the same reason that one is
 * separate from {@link LocalityController}: the two have different guards, and a file where the
 * postures are mixed is a file where a missing annotation reads as normal.
 */
@RestController
public class LocalityQueueController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    /** Seeing which listings are unfiled. */
    private static final String PROPERTIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_READ;

    /** Filing one. */
    private static final String PROPERTIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_PROPERTIES_WRITE;

    private final LocalityQueueService service;

    public LocalityQueueController(LocalityQueueService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/locality-queue} — listings awaiting a locality, live ones first.
     *
     * <p>Capped, with the true count alongside: see {@link LocalityQueueResponse}.
     */
    @GetMapping(Routes.LocalityQueue.BASE)
    @PreAuthorize(PROPERTIES_READ)
    public LocalityQueueResponse queue() {
        return service.queue();
    }

    /**
     * {@code PATCH /admin/locality-queue/{propertyId}} — file one listing under a curated area.
     *
     * <p>409 if the listing already has a locality or the area is retired; 404 if either the
     * listing or the slug is unknown. Returns the row with its new slug, so the console can drop it
     * from the queue on the strength of the reply rather than a re-fetch it might race.
     */
    @PatchMapping(Routes.LocalityQueue.BY_PROPERTY)
    @PreAuthorize(PROPERTIES_WRITE)
    public LocalityQueueEntry assign(@CurrentUser AuthPrincipal principal,
            @PathVariable String propertyId, @Valid @RequestBody LocalityAssignRequest body) {
        return service.assign(principal, propertyId, body.slug());
    }
}
