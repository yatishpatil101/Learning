package com.punenest.api.common.settings;

import java.math.BigDecimal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Typed access to the handful of {@code settings} values the server actually needs.
 *
 * <p><strong>Why this exists rather than a general settings map.</strong> The {@code settings} table
 * is an untyped document store, which is right for ops but wrong as an internal API: a caller that
 * does {@code settings.get("fees").get("rentPayPercent")} has no compile-time protection, no
 * default, and no place to record what a sensible value looks like. Every value the server reads
 * gets a named accessor here, with its fallback and its bounds beside it.
 *
 * <p><strong>Every accessor has a defaulted, in-range answer.</strong> A missing row, malformed
 * JSON, a null, a string where a number was expected, or a nonsensical percentage all resolve to
 * the seeded default. That is not defensive habit — this class sits in the path of taking money,
 * and the alternative to a default is a 500 on the pay button because somebody mistyped a config
 * value in the back office.
 */
@Service
public class PlatformSettings {

    private static final Logger log = LoggerFactory.getLogger(PlatformSettings.class);

    /** The seeded key holding the fee block (see {@code R__seed_reference_data.sql}). */
    private static final String FEES_KEY = "fees";

    /**
     * Convenience fee charged on a rent payment, as a percentage. Matches the frontend mock's
     * {@code FEE_DEFAULTS.rentPayPercent} and the seed row, so an unconfigured environment behaves
     * exactly like the prototype the UI was built against.
     */
    private static final BigDecimal DEFAULT_RENT_PAY_PERCENT = new BigDecimal("2");

    /** Indian GST on the convenience fee. Statutory, and 18% is the current rate for this service. */
    private static final BigDecimal DEFAULT_GST_PERCENT = new BigDecimal("18");

    /**
     * Nothing legitimate charges more than this. A fat-fingered {@code 200} in the back office
     * would otherwise bill a tenant three times their rent as "convenience".
     */
    private static final BigDecimal MAX_PERCENT = new BigDecimal("100");

    /** Credit given to a referrer when ops approves a referral, in whole rupees. */
    private static final long DEFAULT_REFERRAL_REWARD = 500L;

    /**
     * Ceiling on a single referral reward.
     *
     * <p>The same reason as {@link #MAX_PERCENT}, with more at stake: this value is multiplied by
     * however many referrals somebody can generate, so a mistyped extra zero is not one wrong
     * payout but an unbounded one.
     */
    private static final long MAX_REFERRAL_REWARD = 100_000L;

    /**
     * Referrals one referrer may have auto-qualify in a rolling month before the rest go to a human
     * (D61).
     *
     * <p>Ten is deliberately generous, and the reason is on the record: automated velocity limits
     * were avoided here for years precisely because they "would reject genuine roommates and
     * flatmates, which is the platform's most common referral". A flatshare, a floor of neighbours
     * and a WhatsApp group of colleagues all have to fit under it comfortably. It is a threshold for
     * <em>automatic</em> minting only — past it, referrals stay pending for the fraud desk, which is
     * how every referral behaved before Q17 — so setting it too low costs review time, not honest
     * referrers their reward.
     */
    private static final long DEFAULT_REFERRAL_QUALIFY_PER_MONTH = 10L;

    /**
     * Ceiling on that cap.
     *
     * <p>Not a safety limit on money — {@link #MAX_REFERRAL_REWARD} is that — but on the number of
     * rewards a single account can mint without anyone looking. A back office that can type an
     * arbitrarily large number here can switch the fraud desk off by accident.
     */
    private static final long MAX_REFERRAL_QUALIFY_PER_MONTH = 1_000L;

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;

    public PlatformSettings(SettingRepository settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /** The platform's convenience-fee percentage on a rent payment. Never null. */
    @Transactional(readOnly = true)
    public BigDecimal rentPayPercent() {
        return percent(FEES_KEY, "rentPayPercent", DEFAULT_RENT_PAY_PERCENT);
    }

    /** The GST percentage applied to the convenience fee. Never null. */
    @Transactional(readOnly = true)
    public BigDecimal gstPercent() {
        return percent(FEES_KEY, "gstPercent", DEFAULT_GST_PERCENT);
    }

    /**
     * Whole rupees credited to a referrer when ops approves one of their referrals.
     *
     * <p>Configurable rather than a constant in the growth code because it is a price, and every
     * other price the platform charges or pays already lives in this block. Bounded to
     * {@code [0, 100000]} — a referral scheme is the one place where a back-office typo is
     * multiplied by the number of people willing to exploit it.
     */
    @Transactional(readOnly = true)
    public long referralRewardInr() {
        return wholeNumber(FEES_KEY, "referralReward", DEFAULT_REFERRAL_REWARD,
                MAX_REFERRAL_REWARD);
    }

    /**
     * How many referrals one referrer may have qualify automatically in a rolling month (D61).
     *
     * <p>Configuration rather than a constant because it is a fraud threshold, and a fraud threshold
     * has to be movable on the day it is wrong — tightening it during an attack, or loosening it
     * when a campaign makes ten a month normal, must be a deployment change and not a release.
     *
     * <p>Lives in the {@code fees} block beside {@code referralReward} because it is the other half
     * of the same offer: what a referral is worth, and how many of them one account can mint before
     * a human looks. Splitting them across two documents would let one be changed without the other
     * being read.
     */
    @Transactional(readOnly = true)
    public long referralQualifyPerMonth() {
        return wholeNumber(FEES_KEY, "referralQualifyPerMonth", DEFAULT_REFERRAL_QUALIFY_PER_MONTH,
                MAX_REFERRAL_QUALIFY_PER_MONTH);
    }

    /**
     * Reads one numeric field out of a settings document as a whole number in {@code [0, max]},
     * falling back to {@code fallback} for every way that can fail.
     *
     * <p>Named for the shape rather than for rupees: it also reads counts. Every caller supplies its
     * own ceiling, because "how large is too large" is a property of the thing being configured and
     * not of the reader.
     */
    private long wholeNumber(String key, String field, long fallback, long max) {
        try {
            JsonNode value = settings.findById(key)
                    .map(Setting::getValue)
                    .map(objectMapper::readTree)
                    .map(node -> node.get(field))
                    .orElse(null);
            if (value == null || !value.isNumber()) {
                return fallback;
            }
            long parsed = value.asLong();
            if (parsed < 0 || parsed > max) {
                log.warn("settings.{}.{} is {}, outside [0,{}]; using default {}",
                        key, field, parsed, max, fallback);
                return fallback;
            }
            return parsed;
        } catch (RuntimeException malformed) {
            log.warn("settings.{}.{} could not be read; using default {}", key, field, fallback,
                    malformed);
            return fallback;
        }
    }

    /**
     * Reads one numeric field out of a settings document as a percentage in {@code [0, 100]},
     * falling back to {@code fallback} for every way that can fail.
     */
    private BigDecimal percent(String key, String field, BigDecimal fallback) {
        try {
            JsonNode value = settings.findById(key)
                    .map(Setting::getValue)
                    .map(objectMapper::readTree)
                    .map(node -> node.get(field))
                    .orElse(null);
            if (value == null || !value.isNumber()) {
                return fallback;
            }
            BigDecimal parsed = value.decimalValue();
            if (parsed.signum() < 0 || parsed.compareTo(MAX_PERCENT) > 0) {
                log.warn("settings.{}.{} is {}, outside [0,100]; using default {}",
                        key, field, parsed, fallback);
                return fallback;
            }
            return parsed;
        } catch (RuntimeException malformed) {
            log.warn("settings.{}.{} could not be read; using default {}", key, field, fallback,
                    malformed);
            return fallback;
        }
    }
}
