package com.punenest.api.admin;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Capabilities;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The three back-office reporting reads.
 *
 * <p><strong>Finance sits one rung above the other two.</strong> The dashboard and the analytics
 * series are staff-visible because ops cannot moderate a queue it cannot measure; the finance
 * overview is admin-only because what the platform earns is not needed to do that job. The same
 * split is why {@code AdminKpis.revenue30d} is null for staff — a staff-readable dashboard carrying
 * a revenue line would have quietly re-opened the door the finance endpoint closes.
 *
 * <p><strong>The two staff-visible reads additionally require the {@code view_dashboard} capability</strong>
 * (tech debt D67). That is a narrowing of the role guard beside it and never a widening of it: a
 * desk whose bundle omits the capability is refused, and no bundle can admit a caller the role check
 * has already rejected. {@code /admin/finance} is left on the role axis alone — it is admin-only
 * already, and the map's seeded {@code admin} bundle is {@code ["*"]}, so a capability there would
 * be a second lock on a door with one key.
 */
@RestController
public class AdminMetricsController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String SCORECARD_READ =
            STAFF_OR_ADMIN + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD;

    private final AdminMetricsService service;

    public AdminMetricsController(AdminMetricsService service) {
        this.service = service;
    }

    /** {@code GET /admin/dashboard} (contract {@code adminDashboard}). */
    @GetMapping(Routes.Admin.DASHBOARD)
    @PreAuthorize(SCORECARD_READ)
    public AdminKpis dashboard(@CurrentUser AuthPrincipal principal) {
        return service.dashboard(principal);
    }

    /** {@code GET /admin/analytics} (contract {@code adminAnalytics}). */
    @GetMapping(Routes.Admin.ANALYTICS)
    @PreAuthorize(SCORECARD_READ)
    public List<AnalyticsPoint> analytics(
            @RequestParam String metric,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String interval) {
        return service.series(metric, from, to, interval);
    }

    /** {@code GET /admin/finance} (contract {@code adminFinance}) — admin only. */
    @GetMapping(Routes.Admin.FINANCE)
    @PreAuthorize(ADMIN_ONLY)
    public AdminFinance finance() {
        return service.finance();
    }
}
