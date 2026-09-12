package com.draazy.api.admin;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
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
 * has already rejected.
 *
 * <p><strong>And a third axis, per account (tech debt D192/D13).</strong> {@code dashboard:read} and
 * {@code finance:read} narrow the same two guards again, from an account's own document rather than
 * from a team bundle — so an ops hire can be given the queues without the scorecard. Every one of
 * the three is {@code and}-ed on, so the effective answer is the intersection of all of them and no
 * axis can readmit a caller another has refused. {@code /admin/finance} now carries an atom where it
 * previously carried none: the {@code admin} capability bundle is {@code ["*"]} and could not
 * express "this administrator does not see revenue", which is exactly the request D192 records.
 */
@RestController
public class AdminMetricsController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String SCORECARD_READ =
            STAFF_OR_ADMIN + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_DASHBOARD_READ;
    private static final String FINANCE_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_FINANCE_READ;

    private final AdminMetricsService service;
    private final AdminFinanceService finance;

    public AdminMetricsController(AdminMetricsService service, AdminFinanceService finance) {
        this.service = service;
        this.finance = finance;
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
    @PreAuthorize(FINANCE_READ)
    public AdminFinance finance() {
        return finance.finance();
    }

    /**
     * {@code GET /admin/finance/series} (contract {@code adminFinanceSeries}) — admin only.
     *
     * <p>Guarded by {@code FINANCE_READ}, the same expression as the overview and not a weaker one.
     * The revenue mix over two years is the overview's most sensitive field spread across a
     * timeline; a sibling route that settled for the staff guard would have handed out exactly what
     * making {@code /admin/finance} admin-only was for.
     */
    @GetMapping(Routes.Admin.FINANCE_SERIES)
    @PreAuthorize(FINANCE_READ)
    public List<AdminFinanceSeriesPoint> financeSeries(
            @RequestParam(defaultValue = "12") int months) {
        return finance.financeSeries(months);
    }

    /** {@code GET /admin/finance/transactions} (contract {@code adminFinanceTransactions}). */
    @GetMapping(Routes.Admin.FINANCE_TRANSACTIONS)
    @PreAuthorize(FINANCE_READ)
    public PageResponse<AdminFinanceTransaction> financeTransactions(
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return finance.financeTransactions(kind, status, q, page, size);
    }
}
