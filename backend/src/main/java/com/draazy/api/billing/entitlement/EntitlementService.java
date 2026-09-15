package com.draazy.api.billing.entitlement;

import com.draazy.api.billing.plan.Plan;
import com.draazy.api.billing.plan.SubscriptionService;
import com.draazy.api.billing.referral.ReferralRepository;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.trust.ContactAllowanceLookup;
import com.draazy.api.common.trust.ContactUsageLookup;
import com.draazy.api.common.trust.ListingAllowanceLookup;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a caller may do: owner contacts and listing slots, all derived from plan + referrals.
 * Rationale: docs/flows/consumer/plans-billing-refer.md.
 */
@Service
public class EntitlementService implements ContactAllowanceLookup, ListingAllowanceLookup {

    /**
     * Free-tier listing floor. Also what a plan with a {@code null} {@code listing_limit} resolves
     * to. Rationale: docs/flows/consumer/plans-billing-refer.md.
     */
    private static final int DEFAULT_FREE_LISTING_LIMIT = 1;

    /** Integer division: fewer than three referrals earn no slot. */
    private static final int REFERRALS_PER_LISTING_SLOT = 3;

    /** Separate from {@link #REFERRALS_PER_LISTING_SLOT}: two offers that may reprice independently. */
    private static final int REFERRALS_PER_FREE_AGREEMENT = 3;

    private final SubscriptionService subscriptions;
    private final ReferralRepository referrals;
    private final ContactUsageLookup usage;
    private final PlatformSettings settings;

    public EntitlementService(SubscriptionService subscriptions, ReferralRepository referrals,
            ContactUsageLookup usage, PlatformSettings settings) {
        this.subscriptions = subscriptions;
        this.referrals = referrals;
        this.usage = usage;
        this.settings = settings;
    }

    /**
     * {@code GET /me/entitlements} — computed together to avoid two queries running twice.
     * Rationale: docs/flows/consumer/plans-billing-refer.md.
     */
    @Transactional(readOnly = true)
    public EntitlementsDto forUser(UUID userId) {
        Optional<Plan> plan = subscriptions.entitlingPlan(userId);
        long granting = referrals.countGrantingFor(userId);

        int contactBonus = Math.toIntExact(granting * settings.referralContactBonus());
        long used = usage.contactsUsed(userId);

        ContactEntitlementDto contacts;
        if (plan.map(Plan::isUnlimitedContacts).orElse(false)) {
            // Still reports the bonus so an unlimited subscriber sees their referrals honoured
            // when they downgrade.
            contacts = new ContactEntitlementDto(true, used, null, null, contactBonus);
        } else {
            int allowance = Math.toIntExact(settings.freeContactLimit()) + contactBonus;
            int remaining = (int) Math.max(0, allowance - used);
            contacts = new ContactEntitlementDto(false, used, allowance, remaining, contactBonus);
        }

        int listingBonus = Math.toIntExact(granting / REFERRALS_PER_LISTING_SLOT);
        int listingBase = plan.map(Plan::getListingLimit)
                .orElse(DEFAULT_FREE_LISTING_LIMIT);
        ListingEntitlementDto listings =
                new ListingEntitlementDto(listingBase + listingBonus, listingBonus);

        AgreementEntitlementDto agreements = new AgreementEntitlementDto(
                Math.toIntExact(granting / REFERRALS_PER_FREE_AGREEMENT));

        return new EntitlementsDto(contacts, listings, agreements);
    }

    /** Ceiling-only path for the listing gate; skips the contact and agreement halves. */
    @Override
    @Transactional(readOnly = true)
    public int listingAllowance(UUID userId) {
        long granting = referrals.countGrantingFor(userId);
        int base = subscriptions.entitlingPlan(userId)
                .map(Plan::getListingLimit)
                .orElse(DEFAULT_FREE_LISTING_LIMIT);
        return base + Math.toIntExact(granting / REFERRALS_PER_LISTING_SLOT);
    }

    /**
     * Ceiling-only path for the contact gate; must not call {@link #forUser} to avoid a needless
     * usage read.
     */
    @Override
    @Transactional(readOnly = true)
    public OptionalInt contactAllowance(UUID userId) {
        if (subscriptions.entitlingPlan(userId).map(Plan::isUnlimitedContacts).orElse(false)) {
            return OptionalInt.empty();
        }
        long granting = referrals.countGrantingFor(userId);
        return OptionalInt.of(Math.toIntExact(
                settings.freeContactLimit() + granting * settings.referralContactBonus()));
    }
}
