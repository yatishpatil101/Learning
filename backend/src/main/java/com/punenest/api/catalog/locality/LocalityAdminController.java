package com.punenest.api.catalog.locality;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/localities} — curation of the geographic reference table.
 *
 * <p>A separate controller from {@link LocalityController} rather than four more methods on it,
 * because the two have opposite security postures: everything there is {@code security: []} and
 * matched as public by the security chain, everything here is staff-gated. Keeping them in one class
 * would mean a public-by-default file with staff exceptions scattered through it, which is the
 * arrangement where a missing annotation is invisible.
 *
 * <p>The console this backs previously ran entirely on the mock API — the page logged an audit
 * entry to browser storage and changed nothing a visitor could see. These four routes are the first
 * time a curator's edit reaches the table the search facets, the landing pages and the listing
 * resolver all read.
 *
 * <p>Unpaged, like the public list: this is a table of tens of city areas.
 */
@RestController
public class LocalityAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    /** Seeing the curation list, retired areas included. */
    private static final String LOCALITIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_LOCALITIES_READ;

    /** Adding, correcting or retiring one. */
    private static final String LOCALITIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_LOCALITIES_WRITE;

    private final LocalityAdminService service;

    public LocalityAdminController(LocalityAdminService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/localities} — every locality, retired ones included.
     *
     * <p>The one read on the platform that returns inactive localities. {@code GET /localities}
     * cannot: it is the public catalogue, and a retired area that still appears in it is an area
     * search engines keep indexing.
     */
    @GetMapping(Routes.Localities.ADMIN_BASE)
    @PreAuthorize(LOCALITIES_READ)
    public List<LocalityResponse> list() {
        return service.list();
    }

    /** {@code POST /admin/localities} — add an area; 201. 409 if the key is taken. */
    @PostMapping(Routes.Localities.ADMIN_BASE)
    @PreAuthorize(LOCALITIES_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public LocalityResponse create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody LocalityCreateRequest body) {
        return service.create(principal, body);
    }

    /** {@code PATCH /admin/localities/{slug}} — correct one. Sparse: null means "leave alone". */
    @PatchMapping(Routes.Localities.ADMIN_BY_SLUG)
    @PreAuthorize(LOCALITIES_WRITE)
    public LocalityResponse update(@CurrentUser AuthPrincipal principal, @PathVariable String slug,
            @Valid @RequestBody LocalityUpdateRequest body) {
        return service.update(principal, slug, body);
    }

    /**
     * {@code DELETE /admin/localities/{slug}} — retire one.
     *
     * <p><strong>Returns the locality, and does not 204.</strong> The verb is {@code DELETE} because
     * that is what retiring means to the console, but the row survives with {@code active = false}
     * — listings and societies hold foreign keys onto this slug. Answering 204 would tell the client
     * the resource is gone when {@code GET /admin/localities} will still list it; returning the
     * updated row says exactly what happened, and lets the console re-render without a second call.
     */
    @DeleteMapping(Routes.Localities.ADMIN_BY_SLUG)
    @PreAuthorize(LOCALITIES_WRITE)
    public LocalityResponse archive(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug) {
        return service.archive(principal, slug);
    }
}
