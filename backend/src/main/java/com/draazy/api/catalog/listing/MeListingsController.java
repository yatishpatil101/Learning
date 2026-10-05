package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyResponse;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.trust.PrivateFieldVisibility;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** JWT owner-scoping is the gate; the client never supplies the owner id. */
@RestController
public class MeListingsController {

    private final ListingService listingService;
    private final PropertyMapper propertyMapper;

    public MeListingsController(ListingService listingService, PropertyMapper propertyMapper) {
        this.listingService = listingService;
        this.propertyMapper = propertyMapper;
    }

    @GetMapping(Routes.MeListings.BASE)
    public PageResponse<PropertyResponse> myListings(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(listingService.myListings(principal.userId(), pageable),
                p -> ownerResponse(p));
    }

    @PostMapping(Routes.MeListings.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public PropertyResponse create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ListingCreate body) {
        return propertyMapper.toResponse(
                listingService.create(principal.userId(), body), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    @GetMapping(Routes.MeListings.BY_ID)
    public PropertyResponse getMine(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                listingService.getMine(principal.userId(), id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    @PostMapping(Routes.MeListings.DUPLICATE_CHECK)
    public ListingDuplicateVerdict duplicateCheck(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ListingDuplicateCheck body) {
        return listingService.duplicateCheck(principal.userId(), body);
    }

    @PatchMapping(Routes.MeListings.BY_ID)
    public PropertyResponse update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ListingUpdate body) {
        return propertyMapper.toResponse(
                listingService.update(principal, id, body), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    /** No body: the only date that matters is the server's receipt of the owner action. */
    @PostMapping(Routes.MeListings.CONFIRM_AVAILABLE)
    public PropertyResponse confirmAvailable(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return propertyMapper.toResponse(
                listingService.confirmAvailable(principal.userId(), id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    @PostMapping(Routes.MeListings.PAUSE)
    public PropertyResponse pause(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                listingService.pause(principal, id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    @PostMapping(Routes.MeListings.RESUME)
    public PropertyResponse resume(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                listingService.resume(principal, id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    /** Archive frees the one-listing free-tier slot without hard-deleting the row. */
    @DeleteMapping(Routes.MeListings.BY_ID)
    public PropertyResponse archive(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                listingService.archive(principal.userId(), id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    private PropertyResponse ownerResponse(Property property) {
        return propertyMapper.toResponse(property, ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }
}
