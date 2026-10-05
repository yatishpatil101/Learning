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
 * <p>Ops needs all three, but only after receiving the {@code analytics:read} function grant.
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
                    + " and " + BackOfficePermissions.REQUIRE_ANALYTICS_READ;

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
