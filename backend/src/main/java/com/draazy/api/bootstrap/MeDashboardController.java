package com.draazy.api.bootstrap;

import com.draazy.api.billing.entitlement.MeEntitlementsController;
import com.draazy.api.catalog.listing.MeListingsController;
import com.draazy.api.catalog.managed.MeManagedPropertiesController;
import com.draazy.api.catalog.listing.OwnerListingCard;
import com.draazy.api.common.error.ApiException;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.deals.visit.VisitController;
import com.draazy.api.deals.visit.VisitRequestController;
import com.draazy.api.documents.request.MeDocumentRequestsController;
import com.draazy.api.engagement.flatmate.FlatmateApplicationController;
import com.draazy.api.engagement.flatmate.FlatmateHostRoomController;
import com.draazy.api.engagement.flatmate.FlatmateSeekerController;
import com.draazy.api.engagement.history.MeRecentSearchesController;
import com.draazy.api.finance.tenancy.TenancyController;
import com.draazy.api.finance.tenancy.TenancyDto;
import com.draazy.api.leads.contact.MeContactRequestsController;
import com.draazy.api.leads.photos.MePhotoRequestsController;
import com.draazy.api.moderation.verification.PropertyVerificationController;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.services.request.ServiceRequestInvitesController;
import com.draazy.api.services.request.ServiceRequestPartyDto;
import java.util.List;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Composed from the handlers the client would otherwise call one by one, so no section drifts from them. */
@RestController
public class MeDashboardController {

    private static final Logger log = LoggerFactory.getLogger(MeDashboardController.class);

    // The client's MAX_PAGE_SIZE: the page every one of these inbox reads asks for.
    private static final Pageable INBOX_PAGE = PageRequest.of(0, 100);

    private final MeListingsController listings;
    private final FlatmateSeekerController flatmateSeeker;
    private final FlatmateHostRoomController flatmateRooms;
    private final FlatmateApplicationController flatmateGroups;
    private final MeContactRequestsController contactRequests;
    private final MePhotoRequestsController photoRequests;
    private final MeDocumentRequestsController documentRequests;
    private final VisitController visits;
    private final VisitRequestController visitRequests;
    private final TenancyController tenancies;
    private final PropertyVerificationController propertyReviews;
    private final MeRecentSearchesController recentSearches;
    private final ServiceRequestInvitesController serviceRequestInvites;
    private final MeManagedPropertiesController managedProperties;
    private final MeEntitlementsController entitlements;

    public MeDashboardController(MeListingsController listings,
            FlatmateSeekerController flatmateSeeker, FlatmateHostRoomController flatmateRooms,
            FlatmateApplicationController flatmateGroups,
            MeContactRequestsController contactRequests, MePhotoRequestsController photoRequests,
            MeDocumentRequestsController documentRequests, VisitController visits,
            VisitRequestController visitRequests, TenancyController tenancies,
            PropertyVerificationController propertyReviews,
            MeRecentSearchesController recentSearches,
            ServiceRequestInvitesController serviceRequestInvites,
            MeManagedPropertiesController managedProperties, MeEntitlementsController entitlements) {
        this.listings = listings;
        this.flatmateSeeker = flatmateSeeker;
        this.flatmateRooms = flatmateRooms;
        this.flatmateGroups = flatmateGroups;
        this.contactRequests = contactRequests;
        this.photoRequests = photoRequests;
        this.documentRequests = documentRequests;
        this.visits = visits;
        this.visitRequests = visitRequests;
        this.tenancies = tenancies;
        this.propertyReviews = propertyReviews;
        this.recentSearches = recentSearches;
        this.serviceRequestInvites = serviceRequestInvites;
        this.managedProperties = managedProperties;
        this.entitlements = entitlements;
    }

    /** {@code listingTools} adds what only the My Listings panel reads (quota), for a landing on that tab. */
    @GetMapping(Routes.Bootstrap.ME_DASHBOARD)
    public MeDashboardResponse dashboard(@CurrentUser AuthPrincipal principal,
            @RequestParam(defaultValue = "false") boolean listingTools) {
        PageResponse<OwnerListingCard> mine =
                section("listings", () -> listings.myListings(principal, INBOX_PAGE));
        // Each inbox below is scoped to the caller's listings, so without one it is empty by definition.
        boolean owner = mine == null || mine.totalElements() > 0;
        List<TenancyDto> rented = section("tenancies", () -> tenancies.myTenancies(principal));
        List<ServiceRequestPartyDto> invites =
                section("serviceRequestInvites", () -> serviceRequestInvites.myInvites(principal));
        return new MeDashboardResponse(
                mine,
                section("flatmatePosts", () -> flatmateSeeker.myPosts(principal, INBOX_PAGE)),
                section("flatmateRooms", () -> flatmateRooms.myRooms(principal, INBOX_PAGE)),
                section("flatmateGroups", () -> flatmateGroups.myGroups(principal, INBOX_PAGE)),
                owner ? section("contactRequests",
                        () -> contactRequests.myContactRequests(principal, INBOX_PAGE)) : empty(),
                owner ? section("photoRequests",
                        () -> photoRequests.myPhotoRequests(principal, INBOX_PAGE)) : empty(),
                owner ? section("documentRequests",
                        () -> documentRequests.myDocumentRequests(principal, INBOX_PAGE)) : empty(),
                section("flatmateRequests",
                        () -> flatmateSeeker.inbox(principal, null, INBOX_PAGE)),
                owner ? section("groupApplications",
                        () -> flatmateGroups.inbox(principal, INBOX_PAGE)) : empty(),
                section("visits", () -> visits.listVisits(principal, null, INBOX_PAGE)),
                owner ? section("visitRequests",
                        () -> visitRequests.myVisitRequests(principal, INBOX_PAGE)) : empty(),
                owner ? section("propertyReviews",
                        () -> propertyReviews.listMyCases(principal, INBOX_PAGE)) : empty(),
                section("recentSearches", () -> recentSearches.mine(principal)),
                section("managedProperties", () -> managedProperties.mine(principal)),
                rented == null ? null : !rented.isEmpty(),
                invites == null ? null : !invites.isEmpty(),
                listingTools ? section("entitlements", () -> entitlements.mine(principal)) : null);
    }

    private static <T> PageResponse<T> empty() {
        return PageResponse.of(Page.<T>empty(INBOX_PAGE), t -> t);
    }

    // A null section makes the client fall back to that section's own endpoint, which then
    // reports the real error where the screen that needs it can show it.
    private static <T> T section(String name, Supplier<T> read) {
        try {
            return read.get();
        } catch (ApiException | AccessDeniedException e) {
            log.debug("me/dashboard section {} refused: {}", name, e.getMessage());
            return null;
        } catch (RuntimeException e) {
            log.warn("me/dashboard section {} failed; the client will re-read it directly", name, e);
            return null;
        }
    }
}
