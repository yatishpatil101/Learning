package com.punenest.api.engagement.notification;

import com.punenest.api.common.trust.Notifier;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@link Notifier} port, implemented where notifications actually live.
 *
 * <p>This is the {@code engagement} half of the inversion described on the interface: contexts that
 * rank at or below {@code engagement} — {@code leads} being the first — can announce something
 * without importing this package, and the dependency arrow points down rather than sideways.
 *
 * <p>{@code saveAndFlush} rather than {@code save}: both enlist in the caller's transaction and both
 * roll back with it, so the choice is not about durability. Flushing surfaces a constraint failure
 * at the call that caused it instead of at commit, where it would be attributed to whatever the
 * caller was doing next.
 */
@Component
public class NotificationPublisher implements Notifier {

    private final NotificationRepository notifications;

    public NotificationPublisher(NotificationRepository notifications) {
        this.notifications = notifications;
    }

    @Override
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void notify(UUID userId, String type, String title, String body, String link) {
        Notification note = new Notification(userId, type, title, body);
        note.setLink(link);
        notifications.saveAndFlush(note);
    }
}
