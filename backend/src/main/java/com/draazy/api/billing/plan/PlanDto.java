package com.draazy.api.billing.plan;

import java.util.List;

/** Contract {@code Plan} — one line of the public price list. Rationale: docs/flows/consumer/plans-billing-refer.md. */
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
