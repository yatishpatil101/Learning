package com.draazy.api.engagement.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "draazy.engagement.notification-retention.enabled",
        havingValue = "true", matchIfMissing = true)
public class NotificationRetentionSweep {

    private static final Logger log = LoggerFactory.getLogger(NotificationRetentionSweep.class);
    private static final long EVERY_DAY_MS = 24L * 60L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 10L * 60L * 1000L;

    private final NotificationRetention retention;

    public NotificationRetentionSweep(NotificationRetention retention) {
        this.retention = retention;
    }

    @Scheduled(fixedDelay = EVERY_DAY_MS, initialDelay = AFTER_STARTUP_MS)
    public void purgeNotifications() {
        try {
            retention.purgeNow();
        } catch (RuntimeException e) {
            log.error("Notification retention sweep failed; will retry on the next tick", e);
        }
    }
}
