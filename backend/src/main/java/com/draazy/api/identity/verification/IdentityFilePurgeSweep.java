package com.draazy.api.identity.verification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Deletes ID and selfie images {@code draazy.identity.image-retention-days} after the decision —
 * honours the consent-screen retention promise. Off in the {@code test} profile to protect fixtures.
 */
@Component
@ConditionalOnProperty(name = "draazy.identity.purge-sweep.enabled", havingValue = "true",
        matchIfMissing = true)
public class IdentityFilePurgeSweep {

    private static final Logger log = LoggerFactory.getLogger(IdentityFilePurgeSweep.class);
    private static final long EVERY_HOUR_MS = 60L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    private final IdentityVerificationService service;
    private final int retentionDays;

    public IdentityFilePurgeSweep(IdentityVerificationService service,
            @Value("${draazy.identity.image-retention-days:7}") int retentionDays) {
        this.service = service;
        this.retentionDays = retentionDays;
    }

    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void purgeExpiredImages() {
        try {
            int purged = service.purgeExpiredFiles(retentionDays);
            if (purged > 0) {
                log.info("Purged images of {} decided identity cases", purged);
            }
        } catch (RuntimeException e) {
            log.error("Identity image purge failed; will retry on the next tick", e);
        }
    }
}
