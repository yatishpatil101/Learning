package com.draazy.api.bootstrap;

import com.draazy.api.billing.plan.SubscriptionState;
import com.draazy.api.engagement.notification.NotificationController;
import com.draazy.api.engagement.saved.SavedKey;
import com.draazy.api.identity.user.SelfResponse;
import com.draazy.api.leads.conversation.ConversationService;
import java.util.List;

/** Only what every signed-in page draws: navbar, bottom nav and card hearts; a section is null if read failed. */
public record MeBootstrapResponse(
        SelfResponse me,
        SubscriptionState subscription,
        List<SavedKey> saved,
        NotificationController.CountResponse notificationsUnread,
        ConversationService.UnreadCount messagesUnread) {
}