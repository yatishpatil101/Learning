package com.draazy.api.identity.verification;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "draazy.identity.purge-sweep.enabled", havingValue = "true",
        matchIfMissing = true)
public class IdentitySecurityFollowupSweep {

    private static final Logger log = LoggerFactory.getLogger(IdentitySecurityFollowupSweep.class);
    private static final long EVERY_HOUR_MS = 60L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;
    private static final Duration CONFLICT_TTL = Duration.ofDays(30);
    private static final int DELETE_BATCH = 200;

    private final IdentityFilePurgeService filePurge;
    private final IdentityConflictService conflicts;

    public IdentitySecurityFollowupSweep(IdentityFilePurgeService filePurge,
            IdentityConflictService conflicts) {
        this.filePurge = filePurge;
        this.conflicts = conflicts;
    }

    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void retryDeletesAndExpireConflicts() {
        try {
            int retried = filePurge.retryQueuedDeletes(Instant.now(), DELETE_BATCH);
            int deletedConflicts = conflicts.deleteOlderThan(CONFLICT_TTL);
            if (retried > 0 || deletedConflicts > 0) {
                log.info("Identity follow-up sweep retried {} storage deletes and expired {} conflicts",
                        retried, deletedConflicts);
            }
        } catch (RuntimeException e) {
            log.error("Identity follow-up sweep failed; will retry on the next tick", e);
        }
    }
}
