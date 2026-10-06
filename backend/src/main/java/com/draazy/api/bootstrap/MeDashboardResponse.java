package com.draazy.api.bootstrap;

import com.draazy.api.billing.entitlement.EntitlementsDto;
import com.draazy.api.catalog.managed.ManagedPropertyDto;
import com.draazy.api.catalog.property.PropertyResponse;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.deals.deal.DealDto;
import com.draazy.api.deals.visit.VisitDto;
import com.draazy.api.documents.request.DocumentRequestDto;
import com.draazy.api.engagement.flatmate.FlatmateGroupDto;
import com.draazy.api.engagement.flatmate.FlatmateRequestDto;
import com.draazy.api.engagement.flatmate.FlatmateRoomDto;
import com.draazy.api.engagement.flatmate.FlatmateSeekerPostDto;
import com.draazy.api.engagement.flatmate.GroupApplicationDto;
import com.draazy.api.engagement.history.RecentSearchDto;
import com.draazy.api.finance.tenancy.TenancyDto;
import com.draazy.api.leads.contact.ContactRequestResponse;
import com.draazy.api.leads.photos.PhotoRequestResponse;
import com.draazy.api.moderation.verification.PropertyReviewSummary;
import com.draazy.api.services.request.ServiceRequestPartyDto;
import java.util.List;
import org.springframework.data.domain.Page;

/** Each section is exactly what its own endpoint answers, or null when that read failed. */
public record MeDashboardResponse(
        PageResponse<PropertyResponse> listings,
        PageResponse<FlatmateSeekerPostDto> flatmatePosts,
        PageResponse<FlatmateRoomDto> flatmateRooms,
        PageResponse<FlatmateGroupDto> flatmateGroups,
        PageResponse<ContactRequestResponse> contactRequests,
        PageResponse<PhotoRequestResponse> photoRequests,
        PageResponse<DocumentRequestDto> documentRequests,
        PageResponse<FlatmateRequestDto> flatmateRequests,
        PageResponse<GroupApplicationDto> groupApplications,
        PageResponse<VisitDto> visits,
        PageResponse<VisitDto> visitRequests,
        List<TenancyDto> tenancies,
        Page<PropertyReviewSummary> propertyReviews,
        List<RecentSearchDto> recentSearches,
        List<ServiceRequestPartyDto> serviceRequestInvites,
        List<ManagedPropertyDto> managedProperties,
        EntitlementsDto entitlements,
        PageResponse<DealDto> deals) {
}
