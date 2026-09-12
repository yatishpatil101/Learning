package com.draazy.api.identity.auth;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodic cleanup of expired refresh tokens (D10).
 *
 * <p>Runs as a separate trigger class so the cleanup logic is testable directly on
 * {@link RefreshTokenService#pruneExpired(Instant)} without waiting on wall-clock timers.
 */
@Component
@ConditionalOnProperty(name = "draazy.auth.refresh-prune.enabled",
        havingValue = "true", matchIfMissing = true)
public class RefreshTokenPruningSweep {

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenPruningSweep.class);

    // Six hours: frequent enough to keep growth bounded, coarse enough to avoid churn.
    private static final long EVERY_SIX_HOURS_MS = 6L * 60L * 60L * 1000L;

    // Let startup settle before the first pass.
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    private final RefreshTokenService refreshTokens;

    public RefreshTokenPruningSweep(RefreshTokenService refreshTokens) {
        this.refreshTokens = refreshTokens;
    }

    @Scheduled(fixedDelay = EVERY_SIX_HOURS_MS, initialDelay = AFTER_STARTUP_MS)
    public void pruneExpiredTokens() {
        try {
            long deleted = refreshTokens.pruneExpired(Instant.now());
            if (deleted > 0) {
                log.info("Refresh-token sweep deleted {} expired token(s)", deleted);
            }
        } catch (RuntimeException e) {
            // Do not kill the schedule on one bad tick.
            log.error("Refresh-token sweep failed; will retry on the next tick", e);
        }
    }
}
