package com.draazy.api.bootstrap;

import com.draazy.api.billing.plan.PlanDto;
import com.draazy.api.catalog.city.CityResponse;
import com.draazy.api.catalog.property.PropertyCountsResponse;
import com.draazy.api.catalog.property.TrustStatsResponse;
import com.draazy.api.common.settings.GeoPolicyResponse;
import com.draazy.api.common.settings.ListingPolicyResponse;
import com.draazy.api.common.settings.MovePackResponse;
import com.draazy.api.common.settings.PricingResponse;
import java.util.List;
import java.util.Map;

public record BootstrapResponse(
        Map<String, Boolean> flags,
        GeoPolicyResponse geo,
        List<CityResponse> cities,
        PricingResponse pricing,
        ListingPolicyResponse listingPolicy,
        MovePackResponse movePack,
        List<PlanDto> plans,
        PropertyCountsResponse counts,
        TrustStatsResponse trustStats) {
}
