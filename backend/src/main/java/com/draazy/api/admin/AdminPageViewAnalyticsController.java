package com.draazy.api.admin;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.Roles;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The three page-view reports: {@code /admin/analytics/traffic}, {@code …/engagement} and
 * {@code …/surfers}.
 *
 * <p><strong>Guarded exactly like the dashboard.</strong> Ops needs all three — knowing which pages
 * the signed-out majority reach is what a conversion conversation starts from — so they are
 * staff-visible rather than admin-only. They are emphatically not public: a page-by-page breakdown
 * of where visitors go and where they give up is a map of the platform's own weak points, and it is
 * the kind of report that looks harmless enough to leak because it names no one.
 *
 * <p><strong>There is deliberately no {@code analytics:read} atom.</strong> {@code /admin/analytics}
 * is gated on {@code dashboard:read}, and inventing a second permission for siblings of it would
 * mean two names for one decision — the failure mode being a grant that opens one analytics tab and
 * silently not the next, which reads to an operator as a broken page rather than as a missing
 * permission. Same reasoning as {@code AdminPricingController}, which records it first.
 *
 * <p>One controller for three endpoints because they are one screen and one service; the siblings
 * stand alone because each has its own. Splitting these into three would be three files whose
 * docblocks all said the same thing.
 */
@RestController
public class AdminPageViewAnalyticsController {

    private static final String ANALYTICS_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')"
                    + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_DASHBOARD_READ;

    private final AdminPageViewAnalyticsService service;

    public AdminPageViewAnalyticsController(AdminPageViewAnalyticsService service) {
        this.service = service;
    }

    /** {@code GET /admin/analytics/traffic} (contract {@code adminAnalyticsTraffic}). */
    @GetMapping(Routes.Admin.ANALYTICS_TRAFFIC)
    @PreAuthorize(ANALYTICS_READ)
    public AdminAnalyticsTraffic traffic(@RequestParam(required = false) Integer days) {
        return service.traffic(days);
    }

    /** {@code GET /admin/analytics/engagement} (contract {@code adminAnalyticsEngagement}). */
    @GetMapping(Routes.Admin.ANALYTICS_ENGAGEMENT)
    @PreAuthorize(ANALYTICS_READ)
    public AdminAnalyticsEngagement engagement(@RequestParam(required = false) Integer days) {
        return service.engagement(days);
    }

    /** {@code GET /admin/analytics/surfers} (contract {@code adminAnalyticsSurfers}). */
    @GetMapping(Routes.Admin.ANALYTICS_SURFERS)
    @PreAuthorize(ANALYTICS_READ)
    public AdminAnalyticsSurfers surfers(@RequestParam(required = false) Integer days) {
        return service.surfers(days);
    }
}
