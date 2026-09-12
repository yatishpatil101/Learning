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
 * {@code GET /admin/analytics/sla} — how long moderation actually takes.
 *
 * <p><strong>Guarded exactly like the dashboard, and for the same reasons as
 * {@code AdminSupplyGapController}.</strong> Staff-visible rather than admin-only, because the
 * people this measures are the people who have to act on it: a review backlog that only an
 * administrator can see is a backlog nobody clears. It is not public, and the reason is worth
 * stating — this is a report on how slow Draazy is at the one promise it makes to every owner who
 * lists, and the aggregate is a straightforward answer to "how long could a fake listing stay up
 * before anyone looked at it".
 *
 * <p>The same trio as every other back-office read: staff-or-admin, the {@code view_dashboard}
 * capability, and the {@code dashboard:read} back-office grant. There is deliberately no
 * {@code analytics:read} atom — the grant document narrows what an ops role may see, and inventing
 * a per-tab atom for each new report would make it a menu of screens rather than a statement about
 * data, with the reviewer of the next report left guessing which of a dozen near-synonyms applies.
 *
 * <p>Lives on its own controller rather than as another method on {@code AdminMetricsController},
 * whose docblock opens "the three back-office reporting reads" — a claim worth keeping true, and the
 * precedent {@code AdminSupplyGapController} already set.
 */
@RestController
public class AdminSlaController {

    private static final String SLA_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')"
                    + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_DASHBOARD_READ;

    private final AdminSlaService service;

    public AdminSlaController(AdminSlaService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/analytics/sla} (contract {@code adminSlaSummary}).
     *
     * @param days optional window on the decision instant; omitted means all time. Spelled the same
     *             way as {@code /admin/supply-gap} so that two adjacent tabs cannot end up with two
     *             different names for the same control
     */
    @GetMapping(Routes.Admin.ANALYTICS_SLA)
    @PreAuthorize(SLA_READ)
    public SlaSummary sla(@RequestParam(required = false) Integer days) {
        return service.report(days);
    }
}
