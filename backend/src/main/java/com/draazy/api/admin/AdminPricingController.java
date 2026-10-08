package com.draazy.api.admin;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** {@code GET /admin/analytics/pricing}; ops only with the {@code analytics:read} function grant. */
@RestController
public class AdminPricingController {

    private static final String PRICING_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')"
                    + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_ANALYTICS_READ;

    private final AdminPricingService service;

    public AdminPricingController(AdminPricingService service) {
        this.service = service;
    }

    /** {@code GET /admin/analytics/pricing} (contract {@code adminAnalyticsPricing}). */
    @GetMapping(Routes.Admin.ANALYTICS_PRICING)
    @PreAuthorize(PRICING_READ)
    public List<PricingInsightRow> pricing() {
        return service.report();
    }
}
