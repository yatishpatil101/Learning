package com.draazy.api.bootstrap;

import com.draazy.api.billing.plan.PlansController;
import com.draazy.api.common.web.Routes;
import com.draazy.api.engagement.follow.SocietyFollowController;
import com.draazy.api.engagement.notification.NotificationController;
import com.draazy.api.engagement.saved.SavedPropertyController;
import com.draazy.api.engagement.search.SavedSearchController;
import com.draazy.api.identity.user.MeController;
import com.draazy.api.identity.verification.IdentityVerificationController;
import com.draazy.api.leads.conversation.ConversationsController;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Composed from the handlers the client would otherwise call one by one, so no section drifts from its own endpoint. */
@RestController
public class MeBootstrapController {

    private static final Logger log = LoggerFactory.getLogger(MeBootstrapController.class);

    // spring.data.web.pageable.max-page-size: what the shell's own size=500 reads are clamped to.
    private static final Pageable SHELL_PAGE = PageRequest.of(0, 100);

    private final MeController me;
    private final PlansController plans;
    private final IdentityVerificationController identity;
    private final SavedPropertyController saved;
    private final SavedSearchController savedSearches;
    private final SocietyFollowController following;
    private final NotificationController notifications;
    private final ConversationsController conversations;

    public MeBootstrapController(MeController me, PlansController plans,
            IdentityVerificationController identity, SavedPropertyController saved,
            SavedSearchController savedSearches, SocietyFollowController following,
            NotificationController notifications, ConversationsController conversations) {
        this.me = me;
        this.plans = plans;
        this.identity = identity;
        this.saved = saved;
        this.savedSearches = savedSearches;
        this.following = following;
        this.notifications = notifications;
        this.conversations = conversations;
    }

    /** {@code me} is not isolated: a caller who cannot be read must get that error, not a shell. */
    @GetMapping(Routes.Bootstrap.ME)
    public MeBootstrapResponse bootstrap(@CurrentUser AuthPrincipal principal) {
        return new MeBootstrapResponse(
                me.getMe(principal),
                section("subscription", () -> plans.getSubscription(principal)),
                section("identity", () -> identity.status(principal)),
                section("saved", () -> saved.listSaved(principal, SHELL_PAGE)),
                section("savedSearches", () -> savedSearches.list(principal)),
                section("following", () -> following.listFollowing(principal, SHELL_PAGE)),
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
