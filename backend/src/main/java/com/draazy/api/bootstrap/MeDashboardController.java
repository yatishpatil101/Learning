package com.draazy.api.bootstrap;

import com.draazy.api.billing.entitlement.MeEntitlementsController;
import com.draazy.api.catalog.listing.MeListingsController;
import com.draazy.api.catalog.managed.MeManagedPropertiesController;
import com.draazy.api.common.error.ApiException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.deals.deal.MeDealsController;
import com.draazy.api.deals.visit.VisitController;
import com.draazy.api.deals.visit.VisitRequestController;
import com.draazy.api.documents.request.MeDocumentRequestsController;
import com.draazy.api.engagement.flatmate.FlatmateApplicationController;
import com.draazy.api.engagement.flatmate.FlatmateHostRoomController;
import com.draazy.api.engagement.flatmate.FlatmateSeekerController;
import com.draazy.api.engagement.history.MeRecentSearchesController;
import com.draazy.api.finance.tenancy.TenancyController;
import com.draazy.api.leads.contact.MeContactRequestsController;
import com.draazy.api.leads.photos.MePhotoRequestsController;
import com.draazy.api.moderation.verification.PropertyVerificationController;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.services.request.ServiceRequestInvitesController;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Composed from the handlers the client would otherwise call one by one, so no section drifts from its own endpoint. */
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
    private final MeDealsController deals;

    public MeDashboardController(MeListingsController listings,
            FlatmateSeekerController flatmateSeeker, FlatmateHostRoomController flatmateRooms,
            FlatmateApplicationController flatmateGroups,
            MeContactRequestsController contactRequests, MePhotoRequestsController photoRequests,
            MeDocumentRequestsController documentRequests, VisitController visits,
            VisitRequestController visitRequests, TenancyController tenancies,
            PropertyVerificationController propertyReviews,
            MeRecentSearchesController recentSearches,
            ServiceRequestInvitesController serviceRequestInvites,
            MeManagedPropertiesController managedProperties, MeEntitlementsController entitlements,
            MeDealsController deals) {
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
        this.deals = deals;
    }

    @GetMapping(Routes.Bootstrap.ME_DASHBOARD)
    public MeDashboardResponse dashboard(@CurrentUser AuthPrincipal principal) {
        return new MeDashboardResponse(
                section("listings", () -> listings.myListings(principal, INBOX_PAGE)),
                section("flatmatePosts", () -> flatmateSeeker.myPosts(principal, INBOX_PAGE)),
                section("flatmateRooms", () -> flatmateRooms.myRooms(principal, INBOX_PAGE)),
                section("flatmateGroups", () -> flatmateGroups.myGroups(principal, INBOX_PAGE)),
                section("contactRequests",
                        () -> contactRequests.myContactRequests(principal, INBOX_PAGE)),
                section("photoRequests", () -> photoRequests.myPhotoRequests(principal, INBOX_PAGE)),
                section("documentRequests",
                        () -> documentRequests.myDocumentRequests(principal, INBOX_PAGE)),
                section("flatmateRequests",
                        () -> flatmateSeeker.inbox(principal, null, INBOX_PAGE)),
                section("groupApplications", () -> flatmateGroups.inbox(principal, INBOX_PAGE)),
                section("visits", () -> visits.listVisits(principal, INBOX_PAGE)),
                section("visitRequests", () -> visitRequests.myVisitRequests(principal, INBOX_PAGE)),
                section("tenancies", () -> tenancies.myTenancies(principal)),
                section("propertyReviews", () -> propertyReviews.listMyCases(principal, INBOX_PAGE)),
                section("recentSearches", () -> recentSearches.mine(principal)),
                section("serviceRequestInvites", () -> serviceRequestInvites.myInvites(principal)),
                section("managedProperties", () -> managedProperties.mine(principal)),
                section("entitlements", () -> entitlements.mine(principal)),
                section("deals", () -> deals.myDeals(principal, INBOX_PAGE)));
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
