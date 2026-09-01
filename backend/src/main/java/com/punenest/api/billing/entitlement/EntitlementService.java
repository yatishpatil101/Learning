package com.punenest.api.billing.entitlement;

import com.punenest.api.billing.plan.Plan;
import com.punenest.api.billing.plan.SubscriptionService;
import com.punenest.api.billing.referral.ReferralRepository;
import com.punenest.api.common.settings.PlatformSettings;
import com.punenest.api.common.trust.ContactAllowanceLookup;
import com.punenest.api.common.trust.ContactUsageLookup;
import com.punenest.api.common.trust.ListingAllowanceLookup;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * What a caller is allowed to do: owner contacts and listing slots.
 *
 * <p><strong>This replaced a quota that lived in the browser.</strong> Until D31b the free tier's
 * fifteen owner contacts were counted in {@code localStorage}, under a key derived from the user's
 * own mobile number, by a module whose header comment said in as many words that it was not real
 * security. Clearing site data reset it. So did a second browser. The referral bonus that topped it
 * up was computed the same way, from counters the client incremented for itself — which meant the
 * platform's referral scheme paid out a reward the platform never actually granted.
 *
 * <p><strong>Nothing here is stored.</strong> There is no allowance column, no balance, no grant
 * ledger — every number below is derived on each call from rows that already exist for other
 * reasons: the caller's subscription, and the referrals they have earned. That is what makes the
 * arithmetic impossible to corrupt. A stored balance has to be written by every code path that could
 * change it, and is wrong forever the first time one of them forgets; a derived one is right by
 * construction, and a clawed-back referral withdraws its contacts the moment the fraud desk records
 * the decision, with no compensating write to remember.
 *
 * <p><strong>The free tier is a settings value, not a plan row.</strong> A caller with no
 * subscription has nothing in {@code plans} to read, so {@link SubscriptionService#entitlingPlan}
 * returning empty is the normal case rather than an error, and the defaults below are what "no
 * purchase" is worth. Seeding a synthetic Owner Free row into every entitlement check was the
 * alternative and it is worse: it would put the free tier on the public pricing list as a thing to
 * subscribe to.
 *
 * <p><strong>Two ports, pointing opposite ways.</strong> This class implements
 * {@link ContactAllowanceLookup} for {@code leads} and consumes {@link ContactUsageLookup} from it.
 * Neither feature imports the other; both import the kernel. See those interfaces for why the split
 * is where it is.
 */
@Service
public class EntitlementService implements ContactAllowanceLookup, ListingAllowanceLookup {

    /**
     * Live listings a caller with no subscription may hold.
     *
     * <p>Mirrors {@code listing_limit} on the seeded Owner Free plan. Duplicated as a constant
     * rather than read from that row because the free tier is defined by the <em>absence</em> of a
     * subscription — there is no row to read for someone who never bought anything, and looking one
     * up by a hard-coded id would be the same duplication wearing a UUID.
     */
    private static final int DEFAULT_FREE_LISTING_LIMIT = 1;

    /**
     * Qualified referrals that buy one extra listing slot.
     *
     * <p>Three, matching the "refer three owners, list one free" offer the Refer page has always
     * made. Integer division, so the fourth referral earns nothing extra until the sixth — the offer
     * is a whole slot or none, and part of a listing slot is not a thing.
     */
    private static final int REFERRALS_PER_LISTING_SLOT = 3;

    /**
     * Qualified referrals that earn one free rent agreement.
     *
     * <p>Also three, matching the "refer three, get an agreement free" track the Refer page has
     * always shown alongside the listing one. A separate constant from
     * {@link #REFERRALS_PER_LISTING_SLOT} even though the two are equal today, because they are two
     * offers rather than one: pricing may move either without meaning to move the other, and a
     * shared constant would make that a silent change to both.
     */
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
     * {@code GET /me/entitlements} — everything the caller may do, in one answer.
     *
     * <p>Computed together rather than per-field so the contact and listing halves are derived from
     * one read of the caller's plan and one count of their referrals. Two endpoints would have run
     * the same two queries twice and could have straddled a change between them.
     */
    @Transactional(readOnly = true)
    public EntitlementsDto forUser(UUID userId) {
        Optional<Plan> plan = subscriptions.entitlingPlan(userId);
        long granting = referrals.countGrantingFor(userId);

        int contactBonus = Math.toIntExact(granting * settings.referralContactBonus());
        long used = usage.contactsUsed(userId);

        ContactEntitlementDto contacts;
        if (plan.map(Plan::isUnlimitedContacts).orElse(false)) {
            // Still reports the bonus. A subscriber who also referred people has earned those
            // contacts, and hiding the number while the plan makes it moot would make the Refer page
            // look broken to exactly the users who used it most. It reappears the day they downgrade.
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

    /**
     * {@link ListingAllowanceLookup} — the ceiling only, for the listing gate.
     *
     * <p>Narrower than {@link #forUser} for the same reason {@link #contactAllowance} is: the gate
     * is about to count the caller's own listings anyway, and does not need the contact half or the
     * agreement half to decide whether one more listing is allowed.
     */
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
     * {@link ContactAllowanceLookup} — the ceiling only, for the contact gate.
     *
     * <p>A narrower query than {@link #forUser}: the gate needs the allowance and already knows the
     * usage, since it is about to write the row that changes it. Deliberately does not call
     * {@link #forUser} and read one field off the result, because that would make every contact
     * request pay for a count of the caller's own contact requests that the gate does not use.
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
