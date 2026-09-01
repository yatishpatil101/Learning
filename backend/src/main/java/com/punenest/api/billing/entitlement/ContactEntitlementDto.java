package com.punenest.api.billing.entitlement;

/**
 * Contract {@code ContactEntitlement} — the owner-contact half of {@code GET /me/entitlements}.
 *
 * <p><strong>Both the ceiling and the remainder are on the wire, and both may be null.</strong>
 * {@code null} means unlimited, and it is deliberately not a large sentinel number: a client that
 * renders "999,983 contacts left" beside an unlimited plan has been told the truth in a form nobody
 * can read. {@code unlimited} carries the same fact as a boolean so no client has to know that a
 * missing number is good news.
 *
 * <p>{@code remaining} is redundant — it is {@code allowance - used}, floored at zero — and is sent
 * anyway. It is the number every screen actually shows, and the arithmetic is the one place a
 * countdown and a gate can quietly disagree. The server owes clients an answer, not the ingredients
 * for one.
 *
 * <p>{@code referralBonus} is broken out of {@code allowance} rather than folded silently into it
 * because the Refer page has to be able to say what referring earned. It is already inside
 * {@code allowance}; adding the two would double-count.
 *
 * @param unlimited     whether the caller's plan lifts the ceiling entirely
 * @param used          contact requests the caller has opened, for all time
 * @param allowance     total contacts the caller may open, or null when unlimited
 * @param remaining     contacts left, never negative, or null when unlimited
 * @param referralBonus the part of {@code allowance} earned by referrals, zero when none
 */
public record ContactEntitlementDto(
        boolean unlimited,
        long used,
        Integer allowance,
        Integer remaining,
        int referralBonus) {
}
