package com.draazy.api.bootstrap;

import com.draazy.api.billing.plan.PlansController;
import com.draazy.api.common.web.Routes;
import com.draazy.api.engagement.notification.NotificationController;
import com.draazy.api.engagement.saved.SavedPropertyController;
import com.draazy.api.identity.user.MeController;
import com.draazy.api.leads.conversation.ConversationsController;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Composed from the handlers the client would otherwise call one by one, so no section drifts from them. */
@RestController
public class MeBootstrapController {

    private static final Logger log = LoggerFactory.getLogger(MeBootstrapController.class);

    private final MeController me;
    private final PlansController plans;
    private final SavedPropertyController saved;
    private final NotificationController notifications;
    private final ConversationsController conversations;

    public MeBootstrapController(MeController me, PlansController plans,
            SavedPropertyController saved, NotificationController notifications,
            ConversationsController conversations) {
        this.me = me;
        this.plans = plans;
        this.saved = saved;
        this.notifications = notifications;
        this.conversations = conversations;
    }

    /** {@code me} is not isolated: a caller who cannot be read must get that error, not a shell. */
    @GetMapping(Routes.Bootstrap.ME)
    public MeBootstrapResponse bootstrap(@CurrentUser AuthPrincipal principal) {
        return new MeBootstrapResponse(
                me.getMe(principal),
                section("subscription", () -> plans.getSubscription(principal)),
                section("saved", () -> saved.listKeys(principal)),
                section("notificationsUnread", () -> notifications.unreadCount(principal)),
                section("messagesUnread", () -> conversations.unreadCount(principal)));
    }

    // A null section makes the client fall back to that section's own endpoint, which then
    // reports the real error where the screen that needs it can show it.
    private static <T> T section(String name, Supplier<T> read) {
        try {
            return read.get();
        } catch (RuntimeException e) {
            log.warn("me/bootstrap section {} failed; the client will re-read it directly", name, e);
            return null;
        }
    }
}