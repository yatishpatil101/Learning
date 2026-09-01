package com.punenest.api.admin;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Capabilities;
import com.punenest.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /admin/analytics/pricing} — asking prices against the curated market rate, per locality.
 *
 * <p><strong>Guarded exactly like the dashboard, and for the same reason as the supply gap.</strong>
 * Ops needs it — knowing which localities are listed above the market is what a pricing conversation
 * with an owner starts from — so it is staff-visible rather than admin-only. It is not public: a
 * locality-by-locality read of where PuneNest's inventory sits against the market is a map of the
 * platform's own pricing discipline, and it is the kind of report that looks harmless enough to
 * leak because it contains no money.
 *
 * <p><strong>There is deliberately no {@code analytics:read} atom.</strong> {@code /admin/analytics}
 * itself is gated on {@code dashboard:read}, and inventing a second permission for a sibling of it
 * would mean two names for one decision — the failure mode being a grant that opens one analytics
 * tab and silently not the other, which reads to the operator as a broken page rather than as a
 * missing permission.
 *
 * <p>Lives on its own controller rather than as a fourth method on {@code AdminMetricsController},
 * whose docblock opens "the three back-office reporting reads" — a claim worth keeping true, and the
 * same reason {@code AdminSupplyGapController} stands alone.
 */
@RestController
public class AdminPricingController {

    private static final String PRICING_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')"
                    + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_DASHBOARD_READ;

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
