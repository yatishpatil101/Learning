package com.draazy.api.engagement.notification;

import com.draazy.api.common.trust.Notifier;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Implements the notification port so lower layers announce without importing engagement. */
@Component
public class NotificationPublisher implements Notifier {

    private final NotificationRepository notifications;
    private final NotificationPreferenceService preferences;

    /** Clock is a test seam for quiet-hours decisions, not an application-wide knob. */
    private Clock clock = Clock.systemUTC();

    public NotificationPublisher(NotificationRepository notifications,
            NotificationPreferenceService preferences) {
        this.notifications = notifications;
        this.preferences = preferences;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void notify(UUID userId, String type, String title, String body, String link) {
        NotificationPreferencesDto prefs = preferences.effective(userId);
        if (NotificationTypes.isMatchAlert(type) && !prefs.matchAlerts()) {
            return;
        }
        Notification note = new Notification(userId, type, title, body);
        note.setLink(link);
        note.setDeliverAfter(QuietHours.deferUntil(prefs, Instant.now(clock)).orElse(null));
        notifications.saveAndFlush(note);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void markRead(UUID userId, String type, String link) {
        notifications.markReadByTypeAndLink(userId, type, link);
    }

    void useClock(Clock pinned) {
        this.clock = pinned;
    }
}
