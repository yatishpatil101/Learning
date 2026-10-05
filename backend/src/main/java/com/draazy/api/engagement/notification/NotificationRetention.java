package com.draazy.api.engagement.notification;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class NotificationRetention {

    private static final Logger log = LoggerFactory.getLogger(NotificationRetention.class);

    public static final Duration RETENTION = Duration.ofDays(90);

    private final NotificationRepository repository;

    public NotificationRetention(NotificationRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public int purgeOlderThan(Instant cutoff) {
        int removed = repository.deleteCreatedBefore(cutoff);
        if (removed > 0) {
            log.info("Purged {} notifications created before {}", removed, cutoff);
        }
        return removed;
    }

    @Transactional
    public int purgeNow() {
        return purgeOlderThan(Instant.now().minus(RETENTION));
    }
}
