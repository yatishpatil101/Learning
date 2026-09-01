package com.punenest.api.billing.entitlement;

/**
 * Contract {@code Entitlements} — everything {@code GET /me/entitlements} says the caller may do.
 *
 * <p><strong>One endpoint for both halves, on purpose.</strong> A caller's contact allowance and
 * their listing allowance are computed from the same two inputs — the plan they hold and the
 * referrals they have earned — so splitting them across two endpoints would mean two round trips
 * doing the same two queries, and a window in which the answers could come from different states.
 * The client asks "what am I entitled to" once and gets a consistent answer.
 *
 * <p>Deliberately not merged into {@code GET /me/subscription}. That endpoint reports a purchase,
 * including a pending one the user still owes money on; this one reports capability, which a pending
 * purchase does not confer. Same subject, different question, and a client that conflates them shows
 * people entitlements they have not paid for.
 *
 * @param contacts   owner-contact allowance, usage and remainder
 * @param listings   listing-slot allowance
 * @param agreements free rent agreements earned by referring
 */
public record EntitlementsDto(
        ContactEntitlementDto contacts,
        ListingEntitlementDto listings,
        AgreementEntitlementDto agreements) {
}
