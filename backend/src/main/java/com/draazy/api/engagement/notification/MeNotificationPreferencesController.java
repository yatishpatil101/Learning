package com.draazy.api.engagement.notification;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /me/notification-preferences} — the caller's own notification and communication settings.
 *
 * <p>Singular: one document per user, no id, no list. No {@code @PreAuthorize} and no owner check,
 * for the reason the rest of {@code /me/**} gives — the caller <em>is</em> the scope, and there is
 * no parameter here through which they could name anybody else.
 *
 * <p>This is the endpoint tech debt D94 and D15 were both asking for. Before it, every one of these
 * settings lived in one browser's localStorage, which meant the server enforced none of them: the
 * quiet-hours window suppressed the alerts the client derived and nothing else, so a notification
 * the server wrote at 03:00 arrived at 03:00. {@link NotificationPublisher} is the other half.
 */
@RestController
public class MeNotificationPreferencesController {

    private final NotificationPreferenceService preferenceService;

    public MeNotificationPreferencesController(NotificationPreferenceService preferenceService) {
        this.preferenceService = preferenceService;
    }

    /**
     * {@code GET /me/notification-preferences} (contract {@code getNotificationPreferences}).
     *
     * <p>Always 200, never 404: a user who has never saved settings has preferences, they are just
     * the defaults. A 404 would force every client to carry its own copy of those defaults to
     * render the screen — which is the localStorage-only arrangement this replaces.
     */
    @GetMapping(Routes.Engagement.NOTIFICATION_PREFERENCES)
    public NotificationPreferencesDto getNotificationPreferences(@CurrentUser AuthPrincipal principal) {
        return preferenceService.get(principal.userId());
    }

    /** {@code PUT /me/notification-preferences} (contract {@code updateNotificationPreferences}). */
    @PutMapping(Routes.Engagement.NOTIFICATION_PREFERENCES)
    public NotificationPreferencesDto updateNotificationPreferences(
            @CurrentUser AuthPrincipal principal,
            @Valid @RequestBody NotificationPreferencesUpdateRequest body) {
        return preferenceService.update(principal.userId(), body);
    }
}
