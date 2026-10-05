package com.draazy.api.admin;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Capabilities;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// The scorecard is analytics data; a desk lacking the metric bundle is refused.
@RestController
public class AdminMetricsController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String SCORECARD_READ =
            STAFF_OR_ADMIN + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_ANALYTICS_READ;
    private static final String FINANCE_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_FINANCE_READ;

    private final AdminMetricsService service;
    private final AdminFinanceService finance;

    public AdminMetricsController(AdminMetricsService service, AdminFinanceService finance) {
        this.service = service;
        this.finance = finance;
    }

    @GetMapping(Routes.Admin.DASHBOARD)
    @PreAuthorize(SCORECARD_READ)
    public AdminKpis dashboard(@CurrentUser AuthPrincipal principal) {
        return service.dashboard(principal);
    }

    @GetMapping(Routes.Admin.FINANCE)
    @PreAuthorize(FINANCE_READ)
    public AdminFinance finance() {
        return finance.finance();
    }

    @GetMapping(Routes.Admin.FINANCE_SERIES)
    @PreAuthorize(FINANCE_READ)
    public List<AdminFinanceSeriesPoint> financeSeries(
            @RequestParam(defaultValue = "12") int months) {
        return finance.financeSeries(months);
    }

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
