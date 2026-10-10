package com.draazy.api.bootstrap;

import com.draazy.api.billing.entitlement.EntitlementsDto;
import com.draazy.api.catalog.managed.ManagedPropertyDto;
import com.draazy.api.catalog.listing.OwnerListingCard;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.deals.visit.VisitDto;
import com.draazy.api.documents.request.DocumentRequestDto;
import com.draazy.api.engagement.flatmate.FlatmateGroupCard;
import com.draazy.api.engagement.flatmate.FlatmateRequestDto;
import com.draazy.api.engagement.flatmate.FlatmateRoomCard;
import com.draazy.api.engagement.flatmate.FlatmateSeekerPostDto;
import com.draazy.api.engagement.flatmate.GroupApplicationDto;
import com.draazy.api.engagement.history.RecentSearchDto;
import com.draazy.api.leads.contact.ContactRequestResponse;
import com.draazy.api.leads.photos.PhotoRequestResponse;
import com.draazy.api.moderation.verification.ReviewBadge;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** List sections match their own endpoints, or are null when that read failed. Tenancies and invites are flags
 * deciding whether My Rental shows; entitlements only on request. */
public record MeDashboardResponse(
        PageResponse<OwnerListingCard> listings,
        PageResponse<FlatmateSeekerPostDto> flatmatePosts,
        PageResponse<FlatmateRoomCard> flatmateRooms,
        PageResponse<FlatmateGroupCard> flatmateGroups,
        PageResponse<ContactRequestResponse> contactRequests,
        PageResponse<PhotoRequestResponse> photoRequests,
        PageResponse<DocumentRequestDto> documentRequests,
        PageResponse<FlatmateRequestDto> flatmateRequests,
        PageResponse<GroupApplicationDto> groupApplications,
        PageResponse<VisitDto> visits,
        PageResponse<VisitDto> visitRequests,
        PageResponse<ReviewBadge> propertyReviews,
        List<RecentSearchDto> recentSearches,
        List<ManagedPropertyDto> managedProperties,
        Boolean hasTenancy,
        Boolean hasRentalInvite,
        @JsonInclude(JsonInclude.Include.NON_NULL) EntitlementsDto entitlements) {
}
