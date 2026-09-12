package com.draazy.api.billing.plan;

import java.util.List;

/**
 * Contract {@code Plan} — one line of the public price list.
 *
 * @param price whole rupees for one {@code billingCycle}; {@code 0} is the free tier
 * @param listingLimit live listings the plan allows; {@code null} means no cap (D109)
 * @param contactLimit owner contacts the plan grants; {@code null} means unlimited / not-applicable
 */
public record PlanDto(
        String id,
        String name,
        String audience,
        long price,
        String billingCycle,
        Integer listingLimit,
        Integer contactLimit,
        List<String> features) {
}
