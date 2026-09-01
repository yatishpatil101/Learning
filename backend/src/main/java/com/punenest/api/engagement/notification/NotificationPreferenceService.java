package com.punenest.api.engagement.notification;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The caller's own notification preferences, and the read every server-written notification goes
 * through (tech debt D94, D15).
 *
 * <p><strong>Self-scoped throughout.</strong> The subject is always a user id the caller cannot
 * name — {@code /me/notification-preferences} takes no parameter and the controller passes the
 * JWT's principal — so there is no surface here through which one user could read or write
 * another's settings. The row's primary key being the user id means even a mistake in a future
 * caller lands on that user's own row rather than on somebody else's.
 */
@Service
public class NotificationPreferenceService {

    /**
     * What a user who has never opened Settings gets.
     *
     * <p><strong>These constants are a copy, and the copy is the load-bearing part.</strong> They
     * restate {@code NOTIFICATION_PREFERENCE_DEFAULTS} in
     * {@code frontend/src/services/notificationService.js} and V73's column defaults. Three copies
     * is normally a smell; here the alternative is worse. The
     * browser's copy has to exist because it answers before any network call; the database's has to
     * exist because a row inserted by SQL must not disagree with a row inserted by the application;
     * and this one has to exist because it is the answer for the ~100% of accounts that have no row
     * at all. What keeps them honest is {@code NotificationPreferencesEndpointTest}, which reads a
     * row created with column defaults only and asserts it equals this constant.
     *
     * <p><strong>Absent must read as these values and never as silence.</strong> If a missing row
     * meant "every switch off", deploying this slice would mute the platform for every account that
     * exists, and a suppressed notification — unlike a deferred one — is gone. The safe default for
     * a preference the user has never expressed is the behaviour they have had all along.
     */
    static final NotificationPreferencesDto DEFAULTS = new NotificationPreferencesDto(
            true, false, true, true, new QuietHoursDto(false, "22:00", "07:00"), "en");

    private final NotificationPreferenceRepository preferences;
    private final NotificationRepository notifications;

    public NotificationPreferenceService(NotificationPreferenceRepository preferences,
            NotificationRepository notifications) {
        this.preferences = preferences;
        this.notifications = notifications;
    }

    /**
     * Contract {@code getNotificationPreferences} — the caller's settings, or the defaults if they
     * have never saved any.
     */
    @Transactional(readOnly = true)
    public NotificationPreferencesDto get(UUID userId) {
        return effective(userId);
    }

    /**
     * Contract {@code updateNotificationPreferences} — store the whole document and return the
     * server's view of it.
     *
     * <p>Upsert rather than create-then-update, for the reason {@code saveOwnerKyc} gives: there is
     * exactly one row per user by primary key, so "have you saved before" is not a question the
     * client should have to answer with a different verb.
     *
     * <p><strong>Switching quiet hours off releases whatever is still being held.</strong>
     * {@code deliver_after} is stamped once, at write time, against the preferences then in force,
     * so it does not follow a later change of mind. Without this a user notified at 23:00 who opens
     * Settings at 23:30 and turns quiet hours off still could not see that notification until
     * 07:00, and no control anywhere would release it — the server continuing to withhold after
     * being told to stop. Only the "off" transition is handled: a user who merely <em>narrows</em>
     * the window is still expressing a window, and recomputing each held row against a new one is
     * arithmetic in service of a case nobody hits.
     */
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

    /**
     * What the delivery rules should apply for {@code userId} — the stored row, or {@link #DEFAULTS}.
     *
     * <p>Separate from {@link #get} only in intent: {@code get} answers an HTTP request, this
     * answers {@link NotificationPublisher} on the write path of somebody else's transaction. It
     * carries no {@code @Transactional} of its own so it joins whatever the caller is already in
     * rather than opening a second one per notification.
     */
    NotificationPreferencesDto effective(UUID userId) {
        return preferences.findById(userId).map(NotificationPreferencesDto::of).orElse(DEFAULTS);
    }
}
