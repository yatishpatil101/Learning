package com.draazy.api.billing.entitlement;

/**
 * Contract {@code ListingEntitlement} — the listing-slot half of {@code GET /me/entitlements}.
 *
 * <p><strong>Reported, not enforced (D31b).</strong> {@code POST /me/listings} does not yet check
 * this number; the wizard's paywall does. This field exists so the browser stops <em>computing</em>
 * the allowance from {@code localStorage} — the plan limit and the referral bonus are now both
 * server facts, even though the gate they feed is still a client one. That is a smaller change than
 * it looks and an honest one: a client-side gate reading a server-side number can be tightened later
 * without another contract; a client-side gate reading a client-side number cannot be tightened at
 * all.
 *
 * <p>There is no {@code used} or {@code remaining} here, unlike {@code ContactEntitlement}. Active
 * listings can be taken down and put back up, so the count is a live property of the catalogue
 * rather than a tally that only grows, and the listings feature already reports it. Repeating it
 * here would create a second number that could disagree with the first.
 *
 * @param allowance     total live listings the caller's plan and referrals permit
 * @param referralBonus the part of {@code allowance} earned by referrals, zero when none
 */
public record ListingEntitlementDto(
        int allowance,
        int referralBonus) {
}
