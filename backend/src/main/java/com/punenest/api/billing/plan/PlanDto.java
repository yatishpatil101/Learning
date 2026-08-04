package com.punenest.api.billing.plan;

import java.util.List;

/**
 * Contract {@code Plan} — one line of the public price list.
 *
 * @param price whole rupees for one {@code billingCycle}; {@code 0} is the free tier
 */
public record PlanDto(
        String id,
        String name,
        String audience,
        long price,
        String billingCycle,
        List<String> features) {
}
