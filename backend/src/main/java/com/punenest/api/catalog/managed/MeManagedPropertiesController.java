package com.punenest.api.catalog.managed;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The authenticated owner's private managed-property lifecycle at {@code /me/managed-properties}.
 * These are "single-player" records — the Owner Hub, the Property Passport, the rent tracker — that
 * live outside the searchable marketplace until the owner chooses to {@link #publish}.
 *
 * <p>Like {@link com.punenest.api.catalog.listing.MeListingsController}, every operation is scoped to
 * the {@link AuthPrincipal} resolved from the JWT; the id in a path never widens that scope. A
 * record that isn't the caller's returns {@code 404}, never {@code 403}, so we don't confirm another
 * owner's record exists. No {@code @PreAuthorize}: authentication plus owner-scoping is the gate,
 * and any signed-in user may keep managed records.
 */
@RestController
public class MeManagedPropertiesController {

    private final ManagedPropertyService service;

    public MeManagedPropertiesController(ManagedPropertyService service) {
        this.service = service;
    }

    /** {@code GET /me/managed-properties} — the caller's own records, newest first. */
    @GetMapping(Routes.MeManagedProperties.BASE)
    public List<ManagedPropertyDto> mine(@CurrentUser AuthPrincipal principal) {
        return service.list(principal.userId());
    }

    /** {@code POST /me/managed-properties} — register a private record; {@code 201}. */
    @PostMapping(Routes.MeManagedProperties.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public ManagedPropertyDto register(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ManagedPropertyCreateRequest body) {
        return service.register(principal.userId(), body);
    }

    /** {@code GET /me/managed-properties/{id}} — one owned record; {@code 404} if not owned. */
    @GetMapping(Routes.MeManagedProperties.BY_ID)
    public ManagedPropertyDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal.userId(), id);
    }

    /** {@code PATCH /me/managed-properties/{id}} — partial update; only supplied fields change. */
    @PatchMapping(Routes.MeManagedProperties.BY_ID)
    public ManagedPropertyDto update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ManagedPropertyUpdateRequest body) {
        return service.update(principal.userId(), id, body);
    }

    /** {@code DELETE /me/managed-properties/{id}} — hard-delete; {@code 204}. */
    @DeleteMapping(Routes.MeManagedProperties.BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.delete(principal.userId(), id);
    }

    /**
     * {@code POST /me/managed-properties/{id}/publish} — push a private record into the marketplace.
     * Spawns a normal pending listing and links back to it; idempotent (a record already published is
     * returned unchanged).
     */
    @PostMapping(Routes.MeManagedProperties.PUBLISH)
    public ManagedPropertyDto publish(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.publish(principal.userId(), id);
    }
}
