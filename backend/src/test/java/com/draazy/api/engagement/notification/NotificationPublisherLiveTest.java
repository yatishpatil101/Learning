package com.draazy.api.engagement.notification;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.draazy.api.common.trust.LiveUpdates;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** An open tab re-reads its badge when told to, so the stream must say so exactly when it changes. */
class NotificationPublisherLiveTest {

    private final NotificationRepository notifications = mock(NotificationRepository.class);
    private final NotificationPreferenceService preferences = mock(NotificationPreferenceService.class);
    private final LiveUpdates live = mock(LiveUpdates.class);
    private final NotificationPublisher publisher =
            new NotificationPublisher(notifications, preferences, live);
    private final UUID user = UUID.randomUUID();

    @Test
    void aDeliveredNotificationTellsTheUsersTabs() {
        when(preferences.effective(user)).thenReturn(prefs(false));

        publisher.notify(user, "visit", "Visit booked", "Body", "/visits");

        verify(live).notificationsChanged(user);
    }

    @Test
    void oneHeldForQuietHoursStaysSilentUntilItIsDue() {
        when(preferences.effective(user)).thenReturn(prefs(true));
        // 23:30 IST, inside a 22:00-07:00 window.
        publisher.useClock(Clock.fixed(Instant.parse("2026-01-01T18:00:00Z"), ZoneOffset.UTC));

        publisher.notify(user, "visit", "Visit booked", "Body", "/visits");

        verify(notifications).saveAndFlush(any());
        verify(live, never()).notificationsChanged(user);
    }

    @Test
    void markingReadSpeaksOnlyWhenARowChanged() {
        when(notifications.markReadByTypeAndLink(user, "visit", "/a")).thenReturn(0);
        when(notifications.markReadByTypeAndLink(user, "visit", "/b")).thenReturn(1);

        publisher.markRead(user, "visit", "/a");
        verify(live, never()).notificationsChanged(user);

        publisher.markRead(user, "visit", "/b");
        verify(live).notificationsChanged(user);
    }

    private static NotificationPreferencesDto prefs(boolean quiet) {
        return new NotificationPreferencesDto(false, false, false, true,
                new QuietHoursDto(quiet, "22:00", "07:00"), "en");
    }
}
