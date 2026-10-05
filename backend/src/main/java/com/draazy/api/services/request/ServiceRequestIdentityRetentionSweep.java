package com.draazy.api.services.request;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "draazy.services.identity-retention.enabled",
        havingValue = "true", matchIfMissing = true)
public class ServiceRequestIdentityRetentionSweep {

    private static final long EVERY_DAY_MS = 24L * 60L * 60L * 1000L;

    private static final long AFTER_STARTUP_MS = 10L * 60L * 1000L;

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestIdentityRetentionSweep.class);

    private final ServiceRequestIdentityRetention retention;

    ServiceRequestIdentityRetentionSweep(ServiceRequestIdentityRetention retention) {
        this.retention = retention;
    }

    @Scheduled(fixedDelay = EVERY_DAY_MS, initialDelay = AFTER_STARTUP_MS)
    public void purgeIdleIdentities() {
        try {
            retention.purgeNow();
        } catch (RuntimeException e) {
            log.error("Identity retention sweep failed; will retry on the next tick", e);
        }
    }
}
