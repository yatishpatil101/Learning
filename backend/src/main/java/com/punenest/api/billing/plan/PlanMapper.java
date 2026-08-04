package com.punenest.api.billing.plan;

import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Entity→wire projection for plans and subscriptions.
 *
 * <p>Hand-written rather than generated: both projections are three lines of field copying plus the
 * {@code UUID → String} id convention, and {@code api-standards.md} §8.1 prefers the shortest
 * correct form over a MapStruct interface for a mapping this thin. Nothing here is trust-shaped —
 * a plan is public and a subscription is only ever returned to its own holder.
 */
@Component
public class PlanMapper {

    public PlanDto toDto(Plan plan) {
        return new PlanDto(
                plan.getId().toString(),
                plan.getName(),
                plan.getAudience(),
                plan.getPrice(),
                plan.getBillingCycle(),
                List.copyOf(plan.getFeatures()));
    }

    public List<PlanDto> toPlanDtos(List<Plan> plans) {
        return plans.stream().map(this::toDto).toList();
    }

    public SubscriptionDto toDto(Subscription subscription) {
        return new SubscriptionDto(
                subscription.getId().toString(),
                subscription.getPlanId().toString(),
                subscription.getStatus(),
                subscription.getStartedAt(),
                subscription.getRenewsAt(),
                subscription.getPaymentRef());
    }
}
