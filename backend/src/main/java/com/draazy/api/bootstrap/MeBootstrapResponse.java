package com.draazy.api.bootstrap;

import com.draazy.api.billing.plan.SubscriptionDto;
import com.draazy.api.catalog.property.PropertySummary;
import com.draazy.api.catalog.society.SocietyResponse;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.engagement.notification.NotificationController;
import com.draazy.api.engagement.search.SavedSearchResponse;
import com.draazy.api.identity.user.UserResponse;
import com.draazy.api.identity.verification.IdentityVerificationResponse;
import com.draazy.api.leads.conversation.ConversationService;
import java.util.List;

/** Each section is exactly what its own endpoint answers, or null when that read failed. */
public record MeBootstrapResponse(
        UserResponse me,
        SubscriptionDto subscription,
        IdentityVerificationResponse identity,
        PageResponse<PropertySummary> saved,
        List<SavedSearchResponse> savedSearches,
        PageResponse<SocietyResponse> following,
        NotificationController.CountResponse notificationsUnread,
        ConversationService.UnreadCount messagesUnread) {
}
