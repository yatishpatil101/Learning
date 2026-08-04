package com.punenest.api.catalog.listing;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyMapper;
import com.punenest.api.catalog.property.PropertyResponse;
import com.punenest.api.common.trust.ContactVisibility;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The authenticated owner's listing lifecycle at {@code /me/listings} (contract {@code Listings}
 * tag). Every operation is scoped to the {@link AuthPrincipal} resolved from the JWT, so a caller
 * only ever touches their own rows — the id is never taken from the client. Maps the {@link Property}
 * entity to the contract {@link PropertyResponse} at the edge (full detail, owner is the caller).
 *
 * <p>No {@code @PreAuthorize} role guard: the spec carries no {@code x-roles} here and the product
 * lets any signed-in user post (thereby becoming an owner), so authentication + owner-scoping is the
 * correct gate. Role-based restriction would wrongly block a buyer's first post.
 *
 * <p>Every projection here renders {@link ContactVisibility#MASKED}. The "owner" on these rows
 * <em>is</em> the caller, so the number carries no information they do not already have, and keeping
 * the dashboard off the reveal path means the raw-mobile surface stays exactly one endpoint wide
 * ({@code GET /properties/{id}}) — one place to audit rather than five.
 */
@RestController
public class MeListingsController {

    private final ListingService listingService;
    private final PropertyMapper propertyMapper;

    public MeListingsController(ListingService listingService, PropertyMapper propertyMapper) {
        this.listingService = listingService;
        this.propertyMapper = propertyMapper;
    }

    /** {@code GET /me/listings} — the caller's own listings (all statuses incl. archived), paged. */
    @GetMapping(Routes.MeListings.BASE)
    public PageResponse<PropertyResponse> myListings(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(listingService.myListings(principal.userId(), pageable),
                p -> propertyMapper.toResponse(p, ContactVisibility.MASKED));
    }

    /** {@code POST /me/listings} — create a listing; {@code 201}, status forced pending, owner = caller. */
    @PostMapping(Routes.MeListings.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyResponse create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ListingCreate body) {
        return propertyMapper.toResponse(
                listingService.create(principal.userId(), body), ContactVisibility.MASKED);
    }

    /** {@code GET /me/listings/{id}} — a single owned listing by slug-or-id; {@code 404} if not owned. */
    @GetMapping(Routes.MeListings.BY_ID)
    public PropertyResponse getMine(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                listingService.getMine(principal.userId(), id), ContactVisibility.MASKED);
    }

    /**
     * {@code PATCH /me/listings/{id}} — partial update. A foundation-field change reverts the
     * listing to {@code pending}; other edits leave the status untouched. The foundation set is the
     * searchable one — price, bhk, type, locality, deal, furnishing, possession — and is defined
     * once, in {@link ListingService}.
     */
    @PatchMapping(Routes.MeListings.BY_ID)
    public PropertyResponse update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ListingUpdate body) {
        return propertyMapper.toResponse(
                listingService.update(principal.userId(), id, body), ContactVisibility.MASKED);
    }
}
