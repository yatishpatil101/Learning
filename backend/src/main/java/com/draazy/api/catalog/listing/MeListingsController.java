package com.draazy.api.catalog.listing;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.catalog.property.PropertyResponse;
import com.draazy.api.common.trust.BackOfficeVisibility;
import com.draazy.api.common.trust.ContactVisibility;
import com.draazy.api.common.trust.OutreachCounts;
import com.draazy.api.common.trust.PendingLeadLookup;
import com.draazy.api.common.trust.PrivateFieldVisibility;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
    private final PendingLeadLookup pendingLeads;

    public MeListingsController(ListingService listingService, PropertyMapper propertyMapper,
            PendingLeadLookup pendingLeads) {
        this.listingService = listingService;
        this.propertyMapper = propertyMapper;
        this.pendingLeads = pendingLeads;
    }

    @GetMapping(Routes.MeListings.BASE)
    public PageResponse<OwnerListingCard> myListings(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        var page = listingService.myListings(principal.userId(), pageable);
        Map<UUID, Integer> leads = pendingLeads.pendingFor(page.getContent().stream().map(Property::getId).toList());
        return PageResponse.of(page, p -> propertyMapper.toOwnerCard(p, leads));
    }

    @PostMapping(Routes.MeListings.BASE)
    @ResponseStatus(HttpStatus.CREATED)
    public ListingWriteResult create(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ListingCreate body) {
        return propertyMapper.toWriteResult(listingService.create(principal.userId(), body));
    }

    @GetMapping(Routes.MeListings.QUOTA)
    public ListingSlots quota(@CurrentUser AuthPrincipal principal) {
        return listingService.slots(principal.userId());
    }

    @GetMapping(Routes.MeListings.BY_ID)
    public PropertyResponse getMine(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toResponse(
                listingService.getMine(principal.userId(), id), ContactVisibility.MASKED,
                BackOfficeVisibility.HIDDEN, OutreachCounts.NONE, PrivateFieldVisibility.VISIBLE);
    }

    /** The one row a client re-reads after an action that moved it, instead of the whole list. */
    @GetMapping(Routes.MeListings.CARD)
    public OwnerListingCard getMineCard(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return card(listingService.getMine(principal.userId(), id));
    }

    @PostMapping(Routes.MeListings.DUPLICATE_CHECK)
    public ListingDuplicateVerdict duplicateCheck(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ListingDuplicateCheck body) {
        return listingService.duplicateCheck(principal.userId(), body);
    }

    @PatchMapping(Routes.MeListings.BY_ID)
    public ListingWriteResult update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody ListingUpdate body) {
        return propertyMapper.toWriteResult(listingService.update(principal, id, body));
    }

    /** No body: the only date that matters is the server's receipt of the owner action. */
    @PostMapping(Routes.MeListings.CONFIRM_AVAILABLE)
    public OwnerListingCard confirmAvailable(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return card(listingService.confirmAvailable(principal.userId(), id));
    }

    @PostMapping(Routes.MeListings.PAUSE)
    public OwnerListingCard pause(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return card(listingService.pause(principal, id));
    }

    @PostMapping(Routes.MeListings.RESUME)
    public OwnerListingCard resume(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return card(listingService.resume(principal, id));
    }

    /** Archive frees the one-listing free-tier slot without hard-deleting the row. */
    @DeleteMapping(Routes.MeListings.BY_ID)
    public ListingWriteResult archive(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return propertyMapper.toTakenDown(listingService.archive(principal.userId(), id));
    }

    private OwnerListingCard card(Property property) {
        return propertyMapper.toOwnerCard(property, pendingLeads.pendingFor(List.of(property.getId())));
    }
}
