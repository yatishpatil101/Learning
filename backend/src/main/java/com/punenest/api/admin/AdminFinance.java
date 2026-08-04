package com.punenest.api.admin;

import java.util.List;

/**
 * Contract schema {@code AdminFinance} — where the platform's money is, in whole rupees.
 *
 * @param revenue what the platform has earned: rent convenience fees, subscriptions and boosts.
 *     GST is excluded — it is collected on the government's behalf and passed through, so counting
 *     it as revenue overstates the business by 18%.
 * @param payoutsDue rent collected from tenants that still belongs to landlords. The platform holds
 *     this money; it is a liability, not income.
 * @param payoutsCompleted always zero today, and truthfully so: no payout has ever been executed
 *     because no payout mechanism exists ({@code payout_accounts} stores the destination and
 *     nothing writes a remittance). Reported rather than omitted so the day payouts ship, the
 *     figure moves instead of appearing.
 * @param refunds always zero, for the same reason — there is no refund path in the platform.
 * @param breakdown revenue split by source, same units and same exclusions as {@code revenue}
 */
public record AdminFinance(
        long revenue,
        long payoutsDue,
        long payoutsCompleted,
        long refunds,
        List<Line> breakdown) {

    /** One row of the revenue breakdown. */
    public record Line(String source, long amount) {
    }
}
