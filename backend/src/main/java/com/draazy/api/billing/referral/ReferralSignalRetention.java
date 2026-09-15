package com.draazy.api.billing.referral;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Expires the two referral correlation digests after a ninety-day window.
 * Rationale: docs/flows/ops/referrals-fraud.md.
 */
@Service
public class ReferralSignalRetention {

    private static final Logger log = LoggerFactory.getLogger(ReferralSignalRetention.class);

    /**
     * Public so a test can prove the expiry against the real window rather than a retyped copy.
     * Also stated in V64's header and each digest column's {@code COMMENT ON COLUMN}.
     */
    public static final Duration RETENTION = Duration.ofDays(90);

    private final ReferralRepository referrals;
    private final ReferralCodeRepository codes;

    public ReferralSignalRetention(ReferralRepository referrals, ReferralCodeRepository codes) {
        this.referrals = referrals;
        this.codes = codes;
    }

    /**
     * Clear both tables in one transaction so no comparison is left half-erased.
     */
    @Transactional
    public int expireSignalsOlderThan(Instant cutoff) {
        int cleared = referrals.clearSignalsOlderThan(cutoff) + codes.clearSignalsOlderThan(cutoff);
        if (cleared > 0) {
            log.info("Referral signal retention cleared digests on {} row(s)", cleared);
        }
        return cleared;
    }

    /**
     * Carries its own {@code @Transactional} because it calls {@link #expireSignalsOlderThan} on
     * {@code this} — the proxy is bypassed on self-calls. Rationale: docs/flows/ops/referrals-fraud.md.
     */
    @Transactional
    public int expireNow() {
        return expireSignalsOlderThan(Instant.now().minus(RETENTION));
    }
}
