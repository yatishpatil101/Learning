package com.draazy.api.engagement.notification;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Self-scoped: the caller never names a user id, and the row key is the user id. */
@Service
public class NotificationPreferenceService {

    /** Defaults here must match browser and database defaults for users with no row. */
    static final NotificationPreferencesDto DEFAULTS = new NotificationPreferencesDto(
            true, false, true, true, new QuietHoursDto(false, "22:00", "07:00"), "en");

    private final NotificationPreferenceRepository preferences;
    private final NotificationRepository notifications;

    public NotificationPreferenceService(NotificationPreferenceRepository preferences,
            NotificationRepository notifications) {
        this.preferences = preferences;
        this.notifications = notifications;
    }

    /** Contract {@code getNotificationPreferences} — the caller's settings, or the defaults if they
     * have never saved any. */
    @Transactional(readOnly = true)
    public NotificationPreferencesDto get(UUID userId) {
        return effective(userId);
    }

    /** Upsert because each user has one row; disabling quiet hours releases held notifications. */
    @Transactional
    public NotificationPreferencesDto update(UUID userId, NotificationPreferencesUpdateRequest body) {
        NotificationPreference row = preferences.findById(userId)
                .orElseGet(() -> new NotificationPreference(userId));
        row.replace(
                body.email(),
                body.sms(),
                body.whatsapp(),
                body.matchAlerts(),
                body.quietHours().enabled(),
                body.quietHours().start(),
                body.quietHours().end(),
                body.language());
        NotificationPreferencesDto saved = NotificationPreferencesDto.of(preferences.saveAndFlush(row));
        if (!saved.quietHours().enabled()) {
            notifications.releaseDeferred(userId);
        }
        return saved;
    }

    /** No transaction here so publishers join the caller instead of opening one per notification. */
    NotificationPreferencesDto effective(UUID userId) {
        return preferences.findById(userId).map(NotificationPreferencesDto::of).orElse(DEFAULTS);
    }
}
