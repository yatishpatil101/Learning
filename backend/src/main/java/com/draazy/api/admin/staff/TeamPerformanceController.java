package com.draazy.api.admin.staff;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class TeamPerformanceController {

    private static final String GUARD = "hasAnyRole('" + Roles.MANAGER + "', '" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_AUDIT_READ;
    private static final String MY_WORK_GUARD = "hasRole('" + Roles.STAFF + "') and "
            + BackOfficePermissions.REQUIRE_DASHBOARD_READ;

    private final TeamPerformanceService performance;

    TeamPerformanceController(TeamPerformanceService performance) {
        this.performance = performance;
    }

    @GetMapping(Routes.Admin.TEAM_PERFORMANCE)
    @PreAuthorize(GUARD)
    TeamPerformanceResponse teamPerformance(@RequestParam(defaultValue = "7") int days) {
        if (days != 7 && days != 30) {
            throw new BadRequestException("days must be 7 or 30");
        }
        return performance.performance(days);
    }

    @GetMapping(Routes.Admin.MY_WORK)
    @PreAuthorize(MY_WORK_GUARD)
    TeamPerformanceResponse myWork(@CurrentUser AuthPrincipal caller,
            @RequestParam(defaultValue = "7") int days) {
        if (days != 7 && days != 30) {
            throw new BadRequestException("days must be 7 or 30");
        }
        return performance.myWork(caller, days);
    }
}
