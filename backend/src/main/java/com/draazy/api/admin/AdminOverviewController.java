package com.draazy.api.admin;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

// Role-gated only: each section inside is redacted by the atom its standalone read required.
@RestController
public class AdminOverviewController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private final AdminDashboardService dashboard;
    private final AdminBellService bell;

    public AdminOverviewController(AdminDashboardService dashboard, AdminBellService bell) {
        this.dashboard = dashboard;
        this.bell = bell;
    }

    @GetMapping(Routes.Admin.DASHBOARD)
    @PreAuthorize(STAFF_OR_ADMIN)
    public AdminDashboard dashboard(@CurrentUser AuthPrincipal principal) {
        return dashboard.dashboard(principal);
    }

    @GetMapping(Routes.Admin.BELL)
    @PreAuthorize(STAFF_OR_ADMIN)
    public AdminBell bell(@CurrentUser AuthPrincipal principal) {
        return bell.bell(principal);
    }
}