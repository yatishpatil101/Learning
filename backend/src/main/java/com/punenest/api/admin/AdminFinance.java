package com.punenest.api.admin;

import java.util.List;

/**
 * Contract schema {@code AdminFinance} — where the platform's money is, in whole rupees.
 *
 * <p>Three of the fields are disclosures rather than money: they say whether the figure beside them
 * was <em>measured</em> or is a structural zero, because the two render identically and an operator
 * has no other way to tell "nothing was refunded" from "refunds do not exist here" (tech debt D63,
 * D65). They are read from configuration, not from the data — see
 * {@code punenest.finance.*} in {@code application.properties} — so the day a money path ships, the
 * flag flips and the screen's notice disappears without a release.
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
 * @param payoutsMeasured whether {@code payoutsCompleted} counts anything. False while no payout
 *     path exists, which is what makes its zero a disclosure rather than a measurement.
 * @param refundsMeasured the same, for {@code refunds}.
 * @param serviceOrdersCounted whether {@code revenue} includes the services marketplace. False
 *     while {@code service_orders} carries no marker that money arrived, so its {@code amount} is a
 *     quote and folding it in would report income the platform never received.
 */
public record AdminFinance(
        long revenue,
        long payoutsDue,
        long payoutsCompleted,
        long refunds,
        List<Line> breakdown,
        boolean payoutsMeasured,
        boolean refundsMeasured,
        boolean serviceOrdersCounted) {

    /** One row of the revenue breakdown. */
    public record Line(String source, long amount) {
    }
}
