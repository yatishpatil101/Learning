package com.draazy.api.moderation.verification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "draazy.moderation.needs-info-sweep.enabled",
        havingValue = "true", matchIfMissing = true)
public class NeedsInfoSweep {

    private static final Logger log = LoggerFactory.getLogger(NeedsInfoSweep.class);
    private static final long EVERY_HOUR_MS = 60L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 6L * 60L * 1000L;

    private final NeedsInfoSweepService service;

    public NeedsInfoSweep(NeedsInfoSweepService service) {
        this.service = service;
    }

    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void remindAndArchiveSilentNeedsInfoCases() {
        try {
            NeedsInfoSweepService.SweepResult result = service.sweep();
            if (result.reminded() > 0 || result.archived() > 0) {
                log.info("Needs-info sweep sent {} reminder(s) and archived {} listing(s)",
                        result.reminded(), result.archived());
            }
        } catch (RuntimeException e) {
            log.error("Needs-info sweep failed; will retry on the next tick", e);
        }
    }
}
