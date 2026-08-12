package com.punenest.api.finance.tenancy;

import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Self-declared stays and the owner's answer to them (D194) — the second of the two ways a person
 * can prove they lived in a listing, the first being a brokered tenancy.
 *
 * <p>Separate from {@link TenancyController} because the two resources have opposite provenance. A
 * tenancy is created by the system when a rent deal closes and has deliberately no create route at
 * all; a declaration is created by a claimant and exists precisely so a human can answer it. Sharing
 * a controller would put a {@code POST} next to a class whose Javadoc has to say there is none.
 *
 * <p>No {@code @PreAuthorize}: none of these carries {@code x-roles}. Authorisation is a
 * relationship, not a role — the confirm and revoke paths are guarded inside
 * {@link TenancyDeclarationService} by comparing the caller against the declaration's owner, and
 * every refusal answers 404 so that no declaration id is confirmed to exist to a stranger.
 */
@RestController
public class TenancyDeclarationController {

    private final TenancyDeclarationService service;

    public TenancyDeclarationController(TenancyDeclarationService service) {
        this.service = service;
    }

    /**
     * {@code POST /properties/{propId}/tenancy-declarations} (contract
     * {@code declareTenancy}) — claim a past stay. 201; the claim starts {@code pending} and proves
     * nothing until the owner answers.
     */
    @PostMapping(Routes.Tenancies.DECLARATIONS)
    public ResponseEntity<TenancyDeclarationDto> declare(@CurrentUser AuthPrincipal principal,
            @PathVariable("propId") UUID propId,
            @Valid @RequestBody TenancyDeclarationCreateRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(service.declare(principal.userId(), propId, body));
    }

    /**
     * {@code GET /properties/{propId}/tenancy-declarations} (contract
     * {@code listTenancyDeclarations}) — every claim on the listing for its owner, the caller's own
     * claim for anybody else.
     *
     * <p>Paged, because the owner's side is inbound demand: the rows are written by other people,
     * one each, so the list grows with how many strangers claim the flat rather than with anything
     * the owner did. A claimant's own view is a single row and is always page 0.
     */
    @GetMapping(Routes.Tenancies.DECLARATIONS)
    public PageResponse<TenancyDeclarationDto> forProperty(@CurrentUser AuthPrincipal principal,
            @PathVariable("propId") UUID propId,
            @PageableDefault(size = 20) Pageable pageable) {
        return service.forProperty(principal.userId(), propId, pageable);
    }

    /**
     * {@code POST /tenancy-declarations/{id}/confirm} (contract {@code confirmTenancyDeclaration}) —
     * the owner agrees the stay happened, which is the moment the claim becomes evidence.
     */
    @PostMapping(Routes.Tenancies.DECLARATION_CONFIRM)
    public TenancyDeclarationDto confirm(@CurrentUser AuthPrincipal principal,
            @PathVariable("id") UUID id) {
        return service.confirm(principal, id);
    }

    /**
     * {@code POST /tenancy-declarations/{id}/revoke} (contract {@code revokeTenancyDeclaration}) —
     * the owner disagrees, or withdraws a confirmation. The row stays; the eligibility does not.
     */
    @PostMapping(Routes.Tenancies.DECLARATION_REVOKE)
    public TenancyDeclarationDto revoke(@CurrentUser AuthPrincipal principal,
            @PathVariable("id") UUID id) {
        return service.revoke(principal, id);
    }
}
