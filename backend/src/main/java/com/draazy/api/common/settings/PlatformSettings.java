package com.draazy.api.common.settings;

import java.math.BigDecimal;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Typed access to the {@code settings} values the server needs, each with its fallback and bounds.
 * Every accessor answers in range — see docs/system/api-standards.md §4.4.
 */
@Service
public class PlatformSettings {

    private static final Logger log = LoggerFactory.getLogger(PlatformSettings.class);

    /** The seeded key holding the fee block (see {@code R__DML_seed_reference_data.sql}). */
    private static final String FEES_KEY = "fees";

    /** The seeded key holding the feature-toggle block, the same one {@code GET /flags} publishes. */
    static final String FLAGS_KEY = "flags";

    /** Indian GST, as a percentage. Statutory, and 18% is the current rate for these services. */
    private static final BigDecimal DEFAULT_GST_PERCENT = new BigDecimal("18");

    /** Nothing legitimate charges more: a fat-fingered {@code 200} would double a member's bill. */
    private static final BigDecimal MAX_PERCENT = new BigDecimal("100");

    /** Owner contacts a caller with no subscription may open, before any referral bonus. */
    private static final long DEFAULT_FREE_CONTACT_LIMIT = 15L;

    /** Owner contacts granted to a referrer each time one of their referrals qualifies. */
    private static final long DEFAULT_REFERRAL_CONTACT_BONUS = 15L;

    /**
     * Ceiling on both contact numbers above. An extra zero on the bonus is an unbounded grant, and
     * past a thousand the number means "no limit" — which is {@code plans.unlimited_contacts}.
     */
    private static final long MAX_CONTACT_GRANT = 1_000L;

    /**
     * Referrals one referrer may have auto-qualify in a rolling month before the rest go to a human.
     * Deliberately generous; setting it low costs review time, not honest referrers their reward.
     */
    private static final long DEFAULT_REFERRAL_QUALIFY_PER_MONTH = 10L;

    /** Ceiling on that cap: an arbitrarily large number switches the fraud desk off. */
    private static final long MAX_REFERRAL_QUALIFY_PER_MONTH = 1_000L;

    /**
     * The four product prices and the listing feature fee, in whole rupees. These must match what a
     * healthy install answers, or a broken row quietly changes the price rather than failing to read.
     */
    private static final long DEFAULT_OWNER_PLAN_YEARLY = 999L;

    /** @see #DEFAULT_OWNER_PLAN_YEARLY */
    private static final long DEFAULT_OWNER_PRO_YEARLY = 2_499L;

    /** @see #DEFAULT_OWNER_PLAN_YEARLY */
    private static final long DEFAULT_RENT_AGREEMENT_PLATFORM = 500L;

    /** @see #DEFAULT_OWNER_PLAN_YEARLY */
    private static final long DEFAULT_SEEKER_PLUS_TOPUP = 199L;

    /** @see #DEFAULT_OWNER_PLAN_YEARLY */
    private static final long DEFAULT_FEATURED_LISTING = 999L;

    /** Ceiling on every price above: the failure it catches is a trailing zero. */
    private static final long MAX_PRICE = 100_000L;

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;

    public PlatformSettings(SettingRepository settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /** The GST percentage applied to the platform's fees. Never null. */
    @Transactional(readOnly = true)
    public BigDecimal gstPercent() {
        return percent(FEES_KEY, "gstPercent", DEFAULT_GST_PERCENT);
    }

    /*
     * The five product prices, in whole rupees — catalogue prices an operator types in, not amounts
     * computed from a percentage. Named one at a time so field names stay out of caller literals.
     */

    /** Yearly price of the entry owner plan. Zero is a legitimate answer — it is the free tier. */
    @Transactional(readOnly = true)
    public long ownerPlanYearly() {
        return wholeNumber(FEES_KEY, "ownerPlanYearly", DEFAULT_OWNER_PLAN_YEARLY, MAX_PRICE);
    }

    /** Yearly price of the top owner plan. */
    @Transactional(readOnly = true)
    public long ownerProYearly() {
        return wholeNumber(FEES_KEY, "ownerProYearly", DEFAULT_OWNER_PRO_YEARLY, MAX_PRICE);
    }

    /**
     * What the platform charges to draw up a rent agreement — the platform's share only. Stamp duty
     * and registration are the state's, computed per agreement and carried by {@code platform_fees}.
     */
    @Transactional(readOnly = true)
    public long rentAgreementPlatform() {
        return wholeNumber(FEES_KEY, "rentAgreementPlatform", DEFAULT_RENT_AGREEMENT_PLATFORM,
                MAX_PRICE);
    }

    /** What a seeker pays to top up their contact allowance. */
    @Transactional(readOnly = true)
    public long seekerPlusTopup() {
        return wholeNumber(FEES_KEY, "seekerPlusTopup", DEFAULT_SEEKER_PLUS_TOPUP, MAX_PRICE);
    }

    /** What an owner pays to feature one listing. */
    @Transactional(readOnly = true)
    public long featuredListing() {
        return wholeNumber(FEES_KEY, "featuredListing", DEFAULT_FEATURED_LISTING, MAX_PRICE);
    }

    /**
     * Owner contacts a caller with no subscription may open. Lives in settings because such a caller
     * has no {@code plans} row; a "contact" is one {@code contact_requests} row, never the digits.
     */
    @Transactional(readOnly = true)
    public long freeContactLimit() {
        return wholeNumber(FEES_KEY, "freeContactLimit", DEFAULT_FREE_CONTACT_LIMIT,
                MAX_CONTACT_GRANT);
    }

    /**
     * Owner contacts granted to a referrer for each referral that qualifies. Bounded because a
     * referral scheme multiplies a back-office typo by everyone willing to exploit it.
     */
    @Transactional(readOnly = true)
    public long referralContactBonus() {
        return wholeNumber(FEES_KEY, "referralContactBonus", DEFAULT_REFERRAL_CONTACT_BONUS,
                MAX_CONTACT_GRANT);
    }

    /**
     * How many referrals one referrer may have qualify automatically in a rolling month.
     * Configuration rather than a constant: a fraud threshold must move on the day it is wrong.
     */
    @Transactional(readOnly = true)
    public long referralQualifyPerMonth() {
        return wholeNumber(FEES_KEY, "referralQualifyPerMonth", DEFAULT_REFERRAL_QUALIFY_PER_MONTH,
                MAX_REFERRAL_QUALIFY_PER_MONTH);
    }

    /**
     * Whether a mobile the platform has never seen may open an account. Server-enforced, not merely
     * published on {@code GET /flags}; absent means on. See docs/system/api-standards.md §4.4.
     */
    @Transactional(readOnly = true)
    public boolean signupsEnabled() {
        return flag(FLAGS_KEY, "signupsEnabled", true);
    }

    /**
     * Whether {@code POST /auth/staff-login} will issue tokens. Binds staff and not admins, or an
     * admin refused by it would have destroyed the only route back to the switch; absent means on.
     */
    @Transactional(readOnly = true)
    public boolean staffLoginEnabled() {
        return flag(FLAGS_KEY, "staffLoginEnabled", true);
    }

    /**
     * Whether the platform is closed for maintenance. Absent means <em>off</em> — the one inverted
     * flag, because it names an outage rather than a capability. Refusals live in the filter.
     */
    @Transactional(readOnly = true)
    public boolean maintenanceMode() {
        return flag(FLAGS_KEY, "maintenanceMode", false);
    }

    /**
     * Reads one boolean field, answering {@code whenUndecided} for every way the document can fail
     * to say otherwise. The repository call sits outside the {@code try} deliberately: §4.4.
     */
    private boolean flag(String key, String field, boolean whenUndecided) {
        Optional<Setting> row = settings.findById(key);
        if (row.isEmpty()) {
            return whenUndecided;
        }
        JsonNode value;
        try {
            value = objectMapper.readTree(row.get().getValue()).get(field);
        } catch (JacksonException malformed) {
            log.warn("settings.{} is not parseable JSON; treating {} as undecided", key, field,
                    malformed);
            return whenUndecided;
        }
        if (value == null || !value.isBoolean()) {
            return whenUndecided;
        }
        return value.booleanValue();
    }

    /**
     * Reads one numeric field as a whole number in {@code [0, max]}, falling back for every way that
     * can fail. Each caller supplies its own ceiling: "too large" belongs to the thing configured.
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
