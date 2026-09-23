package com.draazy.api.engagement.flatmate;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Takes back flatmate badges and supply that stopped being true since they were written. A trigger
 * class only, so each rule stays testable on its {@link FlatmateTrustReconciler} method. */
@Component
@ConditionalOnProperty(name = "draazy.flatmates.trust-sweeps.enabled",
        havingValue = "true", matchIfMissing = true)
public class FlatmateTrustSweeps {

    private static final Logger log = LoggerFactory.getLogger(FlatmateTrustSweeps.class);

    private static final long EVERY_HOUR_MS = 60L * 60L * 1000L;
    private static final long AFTER_STARTUP_MS = 5L * 60L * 1000L;

    private final FlatmateTrustReconciler reconciler;

    public FlatmateTrustSweeps(FlatmateTrustReconciler reconciler) {
        this.reconciler = reconciler;
    }

    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void reconcileOwnerTier() {
        try {
            int demoted = reconciler.reconcileOwnerTier();
            if (demoted > 0) {
                log.info("Flatmate owner-tier sweep demoted {} post(s)", demoted);
            }
        } catch (RuntimeException e) {
            log.error("Flatmate owner-tier sweep failed; will retry on the next tick", e);
        }
    }

    /** Its own try/catch: an uncaught throw out of a scheduled method stops that method's whole
     * series. */
    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void reconcileAgreementExpiry() {
        try {
            int expired = reconciler.reconcileAgreementExpiry();
            if (expired > 0) {
                log.info("Flatmate agreement-expiry sweep withdrew {} badge(s)", expired);
            }
        } catch (RuntimeException e) {
            log.error("Flatmate agreement-expiry sweep failed; will retry on the next tick", e);
        }
    }

    /** Takes down supply nobody has touched in ninety days — see {@code reconcileStaleSupply}. */
    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void reconcileStaleSupply() {
        try {
            int archived = reconciler.reconcileStaleSupply();
            if (archived > 0) {
                log.info("Flatmate stale-supply sweep archived {} row(s)", archived);
            }
        } catch (RuntimeException e) {
            log.error("Flatmate stale-supply sweep failed; will retry on the next tick", e);
        }
    }

    /** Polled rather than triggered because the registration workflow does not write back to
     * {@code rent_agreements}, so there is no transition to observe. */
    @Scheduled(fixedDelay = EVERY_HOUR_MS, initialDelay = AFTER_STARTUP_MS)
    public void reconcileDraazyAgreements() {
        try {
            int approved = reconciler.reconcileDraazyAgreements();
            if (approved > 0) {
                log.info("Flatmate Draazy-agreement sweep badged {} post(s)", approved);
            }
        } catch (RuntimeException e) {
            log.error("Flatmate Draazy-agreement sweep failed; will retry on the next tick", e);
        }
    }
}
