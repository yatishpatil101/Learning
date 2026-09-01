package com.punenest.api.admin;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.Capabilities;
import com.punenest.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /admin/supply-gap} — the only read of the anonymous demand table.
 *
 * <p><strong>Guarded exactly like the dashboard, and not one rung looser.</strong> Ops needs this to
 * do its job — knowing which localities are under-supplied is what listing acquisition is aimed at —
 * so it is staff-visible rather than admin-only. It is not public, and the reason is worth stating:
 * this is a locality-by-locality map of where PuneNest has demand it cannot serve, which is the most
 * commercially sensitive thing the platform knows about itself. It is also the report a competitor
 * would most like to have, and unlike revenue it looks innocuous enough to leak by accident.
 *
 * <p>Lives on its own controller rather than as a fourth method on {@code AdminMetricsController},
 * whose docblock opens "the three back-office reporting reads" — a claim worth keeping true.
 */
@RestController
public class AdminSupplyGapController {

    private static final String SUPPLY_GAP_READ =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')"
                    + " and " + Capabilities.REQUIRE_VIEW_DASHBOARD
                    + " and " + BackOfficePermissions.REQUIRE_DASHBOARD_READ;

    private final AdminSupplyGapService service;

    public AdminSupplyGapController(AdminSupplyGapService service) {
        this.service = service;
    }

    /** {@code GET /admin/supply-gap} (contract {@code adminSupplyGap}). */
    @GetMapping(Routes.Admin.SUPPLY_GAP)
    @PreAuthorize(SUPPLY_GAP_READ)
    public List<SupplyGapRow> supplyGap(@RequestParam(required = false) Integer days) {
        return service.report(days);
    }
}
