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
 * @param mrr the monthly run rate of the <em>active</em> subscription book, normalised so a yearly
 *     plan contributes a twelfth. Forward-looking, and therefore not a slice of {@code revenue},
 *     which is historical: a cancelled subscription earned what it earned and bills nothing more.
 * @param monthRevenue revenue inside the current Indian calendar month, the figure the console's
 *     headline tile shows. Served rather than left to the client to sum out of the series, because
 *     "this month" is a window the server already cuts and two definitions of it would drift at
 *     every month boundary and in every time zone.
 * @param users everyone with an account, archived rows excluded — the denominator of ARPU.
 * @param payingUsers distinct people who paid anything this month — the denominator of ARPPU.
 *     Both are reported because they answer different questions, and a console showing one of them
 *     under an unqualified label invites the reader to assume it is the other.
 * @param gstCollected tax collected this month. <strong>Rent only</strong>: it is the one source
 *     that stores GST as its own column, and attributing tax to the others would mean applying a
 *     rate this server chose to a price that may already include it.
 * @param pendingSettlement platform fees on rent that has been billed and not settled. Money owed
 *     to the platform, as distinct from {@code payoutsDue}, which is money the platform owes on.
 * @param plans the active subscription book itemised, summing to {@code mrr} by construction
 */
public record AdminFinance(
        long revenue,
        long payoutsDue,
        long payoutsCompleted,
        long refunds,
        List<Line> breakdown,
        boolean payoutsMeasured,
        boolean refundsMeasured,
        boolean serviceOrdersCounted,
        long mrr,
        long monthRevenue,
        long users,
        long payingUsers,
        long gstCollected,
        long pendingSettlement,
        List<PlanLine> plans) {

    /** One row of the revenue breakdown. */
    public record Line(String source, long amount) {
    }

    /**
     * One plan in the active subscription book.
     *
     * @param name the plan's display name, e.g. {@code Owner Plus}
     * @param audience who it is sold to — {@code owner}, {@code tenant}, {@code buyer}, {@code agent}
     * @param billingCycle {@code monthly}, {@code quarterly} or {@code yearly}
     * @param price the sticker price for one billing cycle, <em>not</em> normalised
     * @param active how many subscriptions are currently on it
     * @param monthlyValue what those subscriptions contribute to {@code mrr}
     */
    public record PlanLine(String name, String audience, String billingCycle, long price,
            long active, long monthlyValue) {
    }
}
