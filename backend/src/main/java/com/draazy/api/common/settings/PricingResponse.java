package com.draazy.api.common.settings;

import java.math.BigDecimal;

/** Five named fields rather than the {@code fees} block, whose auto-qualify cap is a fraud threshold that must
 * not be published; naming the five makes that a property of the type, not of a filter. */
public record PricingResponse(
        long ownerPlanYearly,
        long ownerProYearly,
        long rentAgreementPlatform,
        long seekerPlusTopup,
        BigDecimal gstPercent) {
}
