package com.draazy.api.common.settings;

import org.springframework.stereotype.Component;

/** Five named fields rather than the {@code fees} block, so a key ops adds there
 * (e.g. {@code referralQualifyPerMonth}) is never published. */
@Component
public class PricingController {

    private final PlatformSettings settings;

    public PricingController(PlatformSettings settings) {
        this.settings = settings;
    }

    /** Each accessor falls back to the seeded figure and logs: a 500 on the plans page beats a stale price. */
    public PricingResponse pricing() {
        return new PricingResponse(
                settings.ownerPlanYearly(),
                settings.ownerProYearly(),
                settings.rentAgreementPlatform(),
                settings.seekerPlusTopup(),
                settings.gstPercent());
    }
}
