package com.draazy.api.billing.plan;

import com.fasterxml.jackson.annotation.JsonInclude;

/** The held plan and whether it is paid up; the checkout's order fields ride {@link SubscriptionDto} only. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SubscriptionState(String planId, String status) {

    static SubscriptionState of(SubscriptionDto row) {
        return new SubscriptionState(row.planId(), row.status());
    }
}
