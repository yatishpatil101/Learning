package com.draazy.api.engagement.notification;

import com.draazy.api.common.trust.LiveUpdates;
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
    private final LiveUpdates live;

    /** Clock is a test seam for quiet-hours decisions, not an application-wide knob. */
    private Clock clock = Clock.systemUTC();

    public NotificationPublisher(NotificationRepository notifications,
            NotificationPreferenceService preferences, LiveUpdates live) {
        this.notifications = notifications;
        this.preferences = preferences;
        this.live = live;
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
        if (note.getDeliverAfter() == null) {
            live.notificationsChanged(userId);
        }
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void markRead(UUID userId, String type, String link) {
        if (notifications.markReadByTypeAndLink(userId, type, link) > 0) {
            live.notificationsChanged(userId);
        }
    }

    @Override
    public boolean allowsWhatsapp(UUID userId) {
        return preferences.effective(userId).whatsapp();
    }

    void useClock(Clock pinned) {
        this.clock = pinned;
    }
}
