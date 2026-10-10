package com.draazy.api.engagement.notification;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "draazy.engagement.waiting-digest.enabled",
        havingValue = "true", matchIfMissing = true)
public class WaitingDigestSweep {

    private static final Logger log = LoggerFactory.getLogger(WaitingDigestSweep.class);

    private final WaitingDigestService digest;

    public WaitingDigestSweep(WaitingDigestService digest) {
        this.digest = digest;
    }

    @Scheduled(cron = "0 0 10 * * *", zone = "Asia/Kolkata")
    public void sendDigests() {
        try {
            int sent = digest.sendDue(Instant.now());
            if (sent > 0) {
                log.info("Waiting digest sent to {} user(s)", sent);
            }
        } catch (RuntimeException e) {
            log.error("Waiting digest failed; will retry tomorrow", e);
        }
    }
}
