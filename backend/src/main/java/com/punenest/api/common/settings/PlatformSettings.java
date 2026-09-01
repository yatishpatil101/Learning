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
 * does {@code settings.get("fees").get("gstPercent")} has no compile-time protection, no
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

    /** The seeded key holding the fee block (see {@code R__DML_seed_reference_data.sql}). */
    private static final String FEES_KEY = "fees";

    /** Indian GST, as a percentage. Statutory, and 18% is the current rate for these services. */
    private static final BigDecimal DEFAULT_GST_PERCENT = new BigDecimal("18");

    /**
     * Nothing legitimate charges more than this. A fat-fingered {@code 200} in the back office
     * would otherwise bill a member twice what they were quoted.
     */
    private static final BigDecimal MAX_PERCENT = new BigDecimal("100");

    /** Owner contacts a caller with no subscription may open, before any referral bonus (D31b). */
    private static final long DEFAULT_FREE_CONTACT_LIMIT = 15L;

    /** Owner contacts granted to a referrer each time one of their referrals qualifies (D31b). */
    private static final long DEFAULT_REFERRAL_CONTACT_BONUS = 15L;

    /**
     * Ceiling on both contact numbers above.
     *
     * <p>The same reason as {@link #MAX_PERCENT}, with more at stake for the bonus: it is multiplied
     * by however many referrals somebody can generate, so a mistyped extra zero is not one wrong
     * grant but an unbounded one. A thousand owner contacts is already far beyond any honest use of
     * the platform, and past it the number is indistinguishable from "no limit" anyway -- which is
     * what {@code plans.unlimited_contacts} is for, and it should be a deliberate choice rather than
     * something a typo can produce.
     */
    private static final long MAX_CONTACT_GRANT = 1_000L;

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
     * <p>Not a safety limit on money — {@link #MAX_CONTACT_GRANT} is that — but on the number of
     * rewards a single account can mint without anyone looking. A back office that can type an
     * arbitrarily large number here can switch the fraud desk off by accident.
     */
    private static final long MAX_REFERRAL_QUALIFY_PER_MONTH = 1_000L;

    /**
     * The four product prices and the listing feature fee, in whole rupees.
     *
     * <p>These five were the one place the seed row and the frontend's {@code FEE_DEFAULTS}
     * disagreed — the row said 0 / 4999 / 1999 / 299 and the app said 999 / 2499 / 500 / 199. The
     * app's figures won, because they are the ones that have actually been quoted to visitors; the
     * seeded document was the stale copy. Both sides now carry the numbers below.
     *
     * <p>The disagreement is worth recording because of how long it survived: while the browser
     * held its own defaults and never asked the server, neither number could contradict the other,
     * so nothing was wrong until something started reading. A duplicated constant does not drift
     * loudly — it drifts silently and then presents the bill in one go, at the moment the duplicate
     * is finally retired. That retirement is why {@code GET /pricing} exists.
     *
     * <p>The fallback itself exists for an install whose {@code fees} row is missing or unreadable,
     * and the only useful thing it can do in that moment is answer what a healthy install would
     * have answered. A default that differed would let a broken config row quietly change the price
     * rather than merely fail to be read.
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

    /**
     * Ceiling on every price above.
     *
     * <p>{@link #MAX_PERCENT}'s argument, in rupees: the failure it catches is a trailing zero, and
     * a lakh is two orders of magnitude past anything this platform sells to an individual. Past it
     * the number is not a price somebody chose, and quoting it publicly is worse than quoting the
     * default.
     */
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
     * The five product prices, in whole rupees.
     *
     * Whole rupees rather than BigDecimal because none of them has ever had a paisa in it and none
     * ever will: they are catalogue prices an operator types into a box, not amounts computed from
     * a percentage of something. The one value that IS a percentage of something is the one above,
     * and it is BigDecimal for exactly that reason.
     *
     * Named one at a time rather than returned as a map, which is this class's whole argument: a
     * map would put the field names back in the caller's string literals, which is the thing
     * `settings.get("fees").get(...)` did and this class exists to stop.
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
     * What the platform charges to draw up a rent agreement.
     *
     * <p>The platform's share only. Stamp duty and registration are the state's, are computed per
     * agreement from its own terms, and are collected on top — which is why {@code platform_fees}
     * carries them and this does not.
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
     * Owner contacts a caller with no subscription may open (D31b).
     *
     * <p>This is the free tier's whole entitlement, and it has no plan row to live on: a caller with
     * no subscription has nothing in {@code plans} to read. Settings is the only home for a number
     * that describes the absence of a purchase.
     *
     * <p>A "contact" is one {@code contact_requests} row -- the right to put yourself in front of one
     * owner and ask. Under D5 it was never the digits, so metering it does not withhold anything the
     * platform ever handed over.
     */
    @Transactional(readOnly = true)
    public long freeContactLimit() {
        return wholeNumber(FEES_KEY, "freeContactLimit", DEFAULT_FREE_CONTACT_LIMIT,
                MAX_CONTACT_GRANT);
    }

    /**
     * Owner contacts granted to a referrer for each referral that qualifies (D31b).
     *
     * <p>Replaces {@code referralReward}, which was denominated in rupees and paid into a balance no
     * screen rendered and nothing could spend. The offer the product actually makes -- and the one
     * the API contract has always documented -- is contacts, so this is what the platform now pays.
     *
     * <p>Configurable for the same reason the rupee figure was: it is the price of the offer, and a
     * growth campaign that doubles it should be a deployment change rather than a release. Bounded
     * because a referral scheme is the one place a back-office typo is multiplied by the number of
     * people willing to exploit it.
     *
     * <p>Lives in the {@code fees} block beside {@link #referralQualifyPerMonth()} because they are
     * two halves of one offer: what a referral is worth, and how many of them one account can mint
     * before a human looks. Splitting them across two documents would let one be changed without the
     * other being read.
     */
    @Transactional(readOnly = true)
    public long referralContactBonus() {
        return wholeNumber(FEES_KEY, "referralContactBonus", DEFAULT_REFERRAL_CONTACT_BONUS,
                MAX_CONTACT_GRANT);
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
