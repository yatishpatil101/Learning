package com.punenest.api.services.request;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Fires {@link CoFillInviteRetention} once a day (V107).
 *
 * <p>Separate from the policy for the reason {@code ReferralSignalRetentionSweep} is: a schedule is
 * a deployment concern and a retention window is a legal one, and a test that wants to prove the
 * second should not have to wait on the first.
 *
 * <p>Switched off in {@code src/test/resources/application.properties}. Not tidiness — a background
 * thread deleting rows while the suite is asserting on them is a flake nobody would reproduce.
 */
@Component
@ConditionalOnProperty(name = "punenest.services.co-fill-invite-retention.enabled",
        havingValue = "true", matchIfMissing = true)
public class CoFillInviteRetentionSweep {

    private static final long EVERY_DAY_MS = 24L * 60L * 60L * 1000L;

    /** Long enough after boot that a cold start is not competing with the first requests. */
    private static final long AFTER_STARTUP_MS = 10L * 60L * 1000L;

    private static final Logger log = LoggerFactory.getLogger(CoFillInviteRetentionSweep.class);

    private final CoFillInviteRetention retention;

    CoFillInviteRetentionSweep(CoFillInviteRetention retention) {
        this.retention = retention;
    }

    /**
     * Swallows and logs, rather than letting the scheduler suppress the task. A retention sweep that
     * silently stopped running after one bad night is the failure mode that matters here: nothing
     * about the product degrades, so nobody would notice until the numbers had been kept for a year.
     */
    @Scheduled(fixedDelay = EVERY_DAY_MS, initialDelay = AFTER_STARTUP_MS)
    public void expireInvites() {
        try {
            retention.expireNow();
        } catch (RuntimeException e) {
            log.error("Co-fill invite retention sweep failed; will retry on the next tick", e);
        }
    }
}
