package com.draazy.api.billing.entitlement;

/**
 * Contract {@code AgreementEntitlement} — the free-rent-agreement half of
 * {@code GET /me/entitlements}.
 *
 * <p><strong>Why this moved to the server at all.</strong> The Refer page used to compute this
 * number itself, from a referral tally the same browser incremented — the page that advertised the
 * reward was also the page that granted it, so clearing site data destroyed earned perks and a
 * clawed-back referral kept paying out forever. It is now derived on every request from the
 * referrals that justify it, which is why nothing here is stored.
 *
 * <p><strong>There is no {@code used} or {@code remaining}, and that is a scope statement.</strong>
 * Agreements are not sold through this codebase yet — there is no agreement checkout for a credit
 * to be spent at, so a consumption tally would be a column nothing writes and a number nobody could
 * trust. When the wizard's money path lands, "used" becomes a fact about a stamped agreement row,
 * and it belongs next to that stamp rather than being invented here first. Publishing an earned
 * count and no balance is the honest subset: it matches what the Refer page actually renders.
 *
 * @param free rent agreements the caller's referrals have earned them, zero when none
 */
public record AgreementEntitlementDto(int free) {
}
