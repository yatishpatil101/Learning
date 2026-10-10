package com.draazy.api.common.settings;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Service
public class PlatformSettings {

    private static final Logger log = LoggerFactory.getLogger(PlatformSettings.class);

    /** The seeded key holding the fee block (see {@code R__DML_seed_reference_data.sql}). */
    public static final String FEES_KEY = "fees";

    /** The seeded key holding the feature-toggle block, the same one {@code GET /bootstrap} publishes. */
    static final String FLAGS_KEY = "flags";

    /** Indian GST, as a percentage. Statutory, and 18% is the current rate for these services. */
    private static final BigDecimal DEFAULT_GST_PERCENT = new BigDecimal("18");

    private static final BigDecimal MAX_PERCENT = new BigDecimal("100");

    /** Owner contacts a caller with no subscription may open, before any referral bonus. */
    private static final long DEFAULT_FREE_CONTACT_LIMIT = 15L;

    private static final long DEFAULT_REFERRAL_CONTACT_BONUS = 15L;

    // Ceiling on both contact numbers above.
    // Past a thousand means "no limit"; that belongs in `plans.unlimited_contacts`.
    private static final long MAX_CONTACT_GRANT = 1_000L;

    // Referrals one referrer may have auto-qualify in a rolling month before the rest go to a human.
    // Deliberately generous; setting it low costs review time, not honest referrers their reward.
    private static final long DEFAULT_REFERRAL_QUALIFY_PER_MONTH = 10L;

    private static final long MAX_REFERRAL_QUALIFY_PER_MONTH = 1_000L;

    // The four product prices and the listing feature fee, in whole rupees.
    // Defaults match a healthy install so broken rows fail instead of changing prices.
    private static final long DEFAULT_OWNER_PLAN_YEARLY = 999L;

    private static final long DEFAULT_OWNER_PRO_YEARLY = 2_499L;

    private static final long DEFAULT_RENT_AGREEMENT_PLATFORM = 500L;

    private static final long DEFAULT_SEEKER_PLUS_TOPUP = 199L;

    public static final int MAX_PRICE = 100_000;

    // An out-of-range price falls back to its default here, so the admin write must refuse one.
    public static final List<String> PRICE_FIELDS = List.of("ownerPlanYearly", "ownerProYearly",
            "rentAgreementPlatform", "seekerPlusTopup");

    public static final String LISTINGS_KEY = "listings";

    private static final long DEFAULT_MAX_LISTING_PHOTOS = 10L;

    public static final int MIN_LISTING_PHOTOS = 3;

    public static final int MAX_LISTING_PHOTOS = 20;

    public static final String FLATMATES_KEY = "flatmates";

    private static final long DEFAULT_GROUPS_PER_PERSON = 2L;

    public static final int MIN_GROUPS_PER_PERSON = 1;

    public static final int MAX_GROUPS_PER_PERSON = 10;

    private final SettingRepository settings;
    private final SettingsCache cache;
    private final ObjectMapper objectMapper;

    public PlatformSettings(SettingRepository settings, SettingsCache cache,
            ObjectMapper objectMapper) {
        this.settings = settings;
        this.cache = cache;
        this.objectMapper = objectMapper;
    }

    public BigDecimal gstPercent() {
        return percent(FEES_KEY, "gstPercent", DEFAULT_GST_PERCENT);
    }

    /** GST on a whole-rupee amount at the configured rate, rounded half-up to whole rupees. */
    public long gstOn(long rupees) {
        return BigDecimal.valueOf(rupees).multiply(gstPercent())
                .divide(MAX_PERCENT, 0, RoundingMode.HALF_UP).longValueExact();
    }

    public long ownerPlanYearly() {
        return wholeNumber(FEES_KEY, "ownerPlanYearly", DEFAULT_OWNER_PLAN_YEARLY, MAX_PRICE);
    }

    public long ownerProYearly() {
        return wholeNumber(FEES_KEY, "ownerProYearly", DEFAULT_OWNER_PRO_YEARLY, MAX_PRICE);
    }

    public long rentAgreementPlatform() {
        return wholeNumber(FEES_KEY, "rentAgreementPlatform", DEFAULT_RENT_AGREEMENT_PLATFORM,
                MAX_PRICE);
    }

    public long seekerPlusTopup() {
        return wholeNumber(FEES_KEY, "seekerPlusTopup", DEFAULT_SEEKER_PLUS_TOPUP, MAX_PRICE);
    }

    public long freeContactLimit() {
        return wholeNumber(FEES_KEY, "freeContactLimit", DEFAULT_FREE_CONTACT_LIMIT,
                MAX_CONTACT_GRANT);
    }

    public long referralContactBonus() {
        return wholeNumber(FEES_KEY, "referralContactBonus", DEFAULT_REFERRAL_CONTACT_BONUS,
                MAX_CONTACT_GRANT);
    }

    public long referralQualifyPerMonth() {
        return wholeNumber(FEES_KEY, "referralQualifyPerMonth", DEFAULT_REFERRAL_QUALIFY_PER_MONTH,
                MAX_REFERRAL_QUALIFY_PER_MONTH);
    }

    public int maxListingPhotos() {
        return (int) wholeNumber(LISTINGS_KEY, "maxPhotos", DEFAULT_MAX_LISTING_PHOTOS,
                MIN_LISTING_PHOTOS, MAX_LISTING_PHOTOS);
    }

    public int maxGroupsPerPerson() {
        return (int) wholeNumber(FLATMATES_KEY, "maxGroupsPerPerson", DEFAULT_GROUPS_PER_PERSON,
                MIN_GROUPS_PER_PERSON, MAX_GROUPS_PER_PERSON);
    }

    public boolean signupsEnabled() {
        return flag(FLAGS_KEY, "signupsEnabled", true);
    }

    public boolean staffLoginEnabled() {
        return flag(FLAGS_KEY, "staffLoginEnabled", true);
    }

    public boolean subscriptionPlansEnabled() {
        return flag(FLAGS_KEY, "subscriptionPlans", true);
    }

    public boolean maintenanceMode() {
        return flag(FLAGS_KEY, "maintenanceMode", false);
    }

    // Read past the cache: these are kill switches, and one must bite on the next request.
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

    private long wholeNumber(String key, String field, long fallback, long max) {
        return wholeNumber(key, field, fallback, 0L, max);
    }

    private long wholeNumber(String key, String field, long fallback, long min, long max) {
        try {
            JsonNode value = cache.value(key)
                    .map(objectMapper::readTree)
                    .map(node -> node.get(field))
                    .orElse(null);
            if (value == null || !value.isNumber()) {
                return fallback;
            }
            long parsed = value.asLong();
            if (parsed < min || parsed > max) {
                log.warn("settings.{}.{} is {}, outside [{},{}]; using default {}",
                        key, field, parsed, min, max, fallback);
                return fallback;
            }
            return parsed;
        } catch (RuntimeException malformed) {
            log.warn("settings.{}.{} could not be read; using default {}", key, field, fallback,
                    malformed);
            return fallback;
        }
    }

    private BigDecimal percent(String key, String field, BigDecimal fallback) {
        try {
            JsonNode value = cache.value(key)
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
