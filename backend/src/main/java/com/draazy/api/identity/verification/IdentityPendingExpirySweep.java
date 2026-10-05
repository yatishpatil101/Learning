package com.draazy.api.identity.verification;

import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "draazy.identity.purge-sweep.enabled", havingValue = "true",
        matchIfMissing = true)
public class IdentityPendingExpirySweep {

    private static final Logger log = LoggerFactory.getLogger(IdentityPendingExpirySweep.class);
    private static final long EVERY_HOUR_MS = 60L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    private final IdentityVerificationService service;
    private final Duration pendingTtl;

    public IdentityPendingExpirySweep(IdentityVerificationService service,
            @Value("${draazy.identity.pending-ttl:P14D}") Duration pendingTtl) {
        this.service = service;
        this.pendingTtl = pendingTtl;
    }

    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void expireStalePendingCases() {
        try {
            int expired = service.expireStalePending(pendingTtl);
            if (expired > 0) {
                log.info("Expired {} stale pending identity cases", expired);
            }
        } catch (RuntimeException e) {
            log.error("Identity pending expiry failed; will retry on the next tick", e);
        }
    }
}
