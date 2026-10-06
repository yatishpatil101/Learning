package com.draazy.api.bootstrap;

import com.draazy.api.billing.plan.SubscriptionService;
import com.draazy.api.catalog.city.CityService;
import com.draazy.api.catalog.property.ListingCounts;
import com.draazy.api.catalog.property.PropertyCountsService;
import com.draazy.api.common.settings.AppFlagsController;
import com.draazy.api.common.settings.GeoPolicyController;
import com.draazy.api.common.settings.ListingPolicyController;
import com.draazy.api.common.settings.MovePackController;
import com.draazy.api.common.settings.PricingController;
import com.draazy.api.common.web.Routes;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Every section must answer every caller identically, because PublicReadCacheFilter shares one cached copy. */
@RestController
public class BootstrapController {

    private final AppFlagsController flags;
    private final GeoPolicyController geo;
    private final CityService cities;
    private final PricingController pricing;
    private final ListingPolicyController listingPolicy;
    private final MovePackController movePack;
    private final SubscriptionService plans;
    private final PropertyCountsService counts;
    private final ListingCounts listingCounts;

    public BootstrapController(AppFlagsController flags, GeoPolicyController geo, CityService cities,
            PricingController pricing, ListingPolicyController listingPolicy,
            MovePackController movePack, SubscriptionService plans, PropertyCountsService counts,
            ListingCounts listingCounts) {
        this.flags = flags;
        this.geo = geo;
        this.cities = cities;
        this.pricing = pricing;
        this.listingPolicy = listingPolicy;
        this.movePack = movePack;
        this.plans = plans;
        this.counts = counts;
        this.listingCounts = listingCounts;
    }

    @GetMapping(Routes.Bootstrap.BASE)
    public BootstrapResponse bootstrap() {
        return new BootstrapResponse(flags.flags(), geo.geo(), cities.list(), pricing.pricing(),
                listingPolicy.listingPolicy(), movePack.movePack(), plans.listPlans(), counts.counts(),
                listingCounts.trustStats());
    }
}
