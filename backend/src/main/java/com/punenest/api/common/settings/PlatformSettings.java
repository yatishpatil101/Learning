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
        return rupees(FEES_KEY, "referralReward", DEFAULT_REFERRAL_REWARD, MAX_REFERRAL_REWARD);
    }

    /**
     * Reads one numeric field out of a settings document as whole rupees in {@code [0, max]},
     * falling back to {@code fallback} for every way that can fail.
     */
    private long rupees(String key, String field, long fallback, long max) {
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
