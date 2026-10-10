package com.draazy.api.admin;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AdminIntegrationsController {

    private static final String SETTINGS_READ =
            "hasRole('" + Roles.ADMIN + "') and " + BackOfficePermissions.REQUIRE_SETTINGS_READ;

    private final AdminIntegrationsService integrations;

    public AdminIntegrationsController(AdminIntegrationsService integrations) {
        this.integrations = integrations;
    }

    @GetMapping(Routes.Admin.INTEGRATIONS)
    @PreAuthorize(SETTINGS_READ)
    public List<AdminProviderHealth> health() {
        return integrations.health();
    }

    @GetMapping(Routes.Admin.INTEGRATION_CALLS)
    @PreAuthorize(SETTINGS_READ)
    public PageResponse<AdminProviderCall> calls(
            @RequestParam(required = false) String provider,
            @RequestParam(required = false) String outcome,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return integrations.calls(provider, outcome, q, page, size);
    }
}
