package com.draazy.api.admin;

import java.util.List;

public record AdminFinance(
        long revenue,
        long refunds,
        List<Line> breakdown,
        boolean refundsMeasured,
        boolean serviceOrdersCounted,
        long mrr,
        long monthRevenue,
        long users,
        long payingUsers,
        List<PlanLine> plans) {

    public record Line(String source, long amount) {
    }

    public record PlanLine(String name, String audience, String billingCycle, long price,
            long active, long monthlyValue) {
    }
    }
