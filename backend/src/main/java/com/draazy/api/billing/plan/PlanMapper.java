package com.draazy.api.billing.plan;

import com.draazy.api.common.settings.PlatformSettings;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.ToLongFunction;
import org.springframework.stereotype.Component;

/** A paid plan's price is the admin fee schedule's figure, not {@code plans.price}.
 * Keyed by seeded id because the seed may rename a plan but never re-ids one. */
@Component
public class PlanMapper {

    private static final Map<UUID, ToLongFunction<PlatformSettings>> ADMIN_PRICED = Map.of(
            UUID.fromString("b1000000-0000-4000-8000-000000000002"), PlatformSettings::ownerPlanYearly,
            UUID.fromString("b1000000-0000-4000-8000-000000000003"), PlatformSettings::ownerProYearly,
            UUID.fromString("b1000000-0000-4000-8000-000000000004"), PlatformSettings::seekerPlusTopup);

    private final PlatformSettings settings;

    public PlanMapper(PlatformSettings settings) {
        this.settings = settings;
    }

    public long price(Plan plan) {
        ToLongFunction<PlatformSettings> adminPrice = ADMIN_PRICED.get(plan.getId());
        return adminPrice == null ? plan.getPrice() : adminPrice.applyAsLong(settings);
    }

    public PlanDto toDto(Plan plan) {
        return new PlanDto(
                plan.getId().toString(),
                plan.getName(),
                plan.getAudience(),
                price(plan),
                plan.getBillingCycle(),
                plan.getListingLimit(),
                plan.getContactLimit(),
                List.copyOf(plan.getFeatures()));
    }

    public List<PlanDto> toPlanDtos(List<Plan> plans) {
        return plans.stream().map(this::toDto).sorted(Comparator.comparingLong(PlanDto::price)).toList();
    }

    public SubscriptionDto toDto(Subscription subscription) {
        // paymentSessionId is single-use and never stored, so it is null from the entity; the
        // subscribe flow attaches a fresh one via withPaymentSessionId for a priced plan.
        return new SubscriptionDto(
                subscription.getId().toString(),
                subscription.getPlanId().toString(),
                subscription.getStatus(),
                subscription.getPaymentRef(),
                null);
    }
}
