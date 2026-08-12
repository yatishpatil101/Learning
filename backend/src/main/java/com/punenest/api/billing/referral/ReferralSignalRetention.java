package com.punenest.api.billing.referral;

import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Expires the two referral correlation digests ninety days after they were captured (D55).
 *
 * <p><strong>Why there is a clock on them at all.</strong> {@code same_device} and {@code same_ip}
 * need both sides of a comparison, so the platform now keeps a salted digest of the address and
 * User-Agent each party was on — personal data, collected for one purpose. Purpose limitation only
 * means something if it has an end date: without one the platform would hold a permanent record of
 * where every user was the day they signed up, in service of a fraud question that stops being
 * answerable long before that.
 *
 * <p><strong>Why ninety days.</strong> Long enough for a desk working a queue to correlate a cluster
 * of referrals, and to answer a challenge about a decision it made weeks ago. Short enough that the
 * data is gone well before the referral itself is — the row stays, because the reward and its
 * decision are financial records with their own retention, and it is only the evidence underneath
 * that expires.
 *
 * <p><strong>The findings outlive the evidence, on purpose.</strong> {@code same_device} and
 * {@code same_ip} were computed at redemption and are not cleared. They are outcomes rather than
 * identifiers — the same shape as {@code aadhaar_verified} recording that a check passed without
 * keeping the number — and erasing a desk's conclusions along with its working is not what a
 * retention limit asks for.
 *
 * <p><strong>This integrates with erasure rather than replacing it.</strong> A time-based expiry
 * that runs for everybody is a different mechanism from a subject's erasure request, and neither
 * substitutes for the other. The overlap is disclosed in {@code ErasureRetention#knownGaps()},
 * which tells the subject that the referral tables hold data the erasure sweep does not reach and
 * how long it lives.
 *
 * <p>Split from {@link ReferralSignalRetentionSweep} for the reason
 * {@code RefreshTokenPruningSweep} gives: the expiry is then provable at a cutoff a test chooses,
 * instead of by waiting on a wall clock.
 */
@Service
public class ReferralSignalRetention {

    private static final Logger log = LoggerFactory.getLogger(ReferralSignalRetention.class);

    /**
     * See the class Javadoc. Also stated in V64's header and in each of the four digest columns'
     * {@code COMMENT ON COLUMN} entries. Public so a test can prove the expiry against the real
     * window rather than against a number retyped beside it — the two drifting apart is exactly how
     * a retention promise quietly stops being kept.
     */
    public static final Duration RETENTION = Duration.ofDays(90);

    private final ReferralRepository referrals;
    private final ReferralCodeRepository codes;

    public ReferralSignalRetention(ReferralRepository referrals, ReferralCodeRepository codes) {
        this.referrals = referrals;
        this.codes = codes;
    }

    /**
     * Clear every digest captured before {@code cutoff}, on both sides of the comparison.
     *
     * <p>Both tables in one transaction: they hold the two halves of the same signal, and a partial
     * run would leave a comparison nobody can reproduce.
     */
    @Transactional
    public int expireSignalsOlderThan(Instant cutoff) {
        int cleared = referrals.clearSignalsOlderThan(cutoff) + codes.clearSignalsOlderThan(cutoff);
        if (cleared > 0) {
            log.info("Referral signal retention cleared digests on {} row(s)", cleared);
        }
        return cleared;
    }

    /** The window applied to now. Separated so the scheduled trigger carries no policy of its own. */
    public int expireNow() {
        return expireSignalsOlderThan(Instant.now().minus(RETENTION));
    }
}
