package com.draazy.api.catalog.locality;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LocalityAdminController {

    private static final String STAFF_OR_ADMIN = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "') and ";

    private static final String READ = STAFF_OR_ADMIN + BackOfficePermissions.REQUIRE_LOCALITIES_READ;

    private static final String WRITE = STAFF_OR_ADMIN + BackOfficePermissions.REQUIRE_LOCALITIES_WRITE;

    private final LocalityService localityService;

    public LocalityAdminController(LocalityService localityService) {
        this.localityService = localityService;
    }

    @GetMapping(Routes.Localities.ADMIN)
    @PreAuthorize(READ)
    public List<LocalityAdminRow> list() {
        return localityService.adminList();
    }

    @PostMapping(Routes.Localities.ADMIN_RETIRE)
    @PreAuthorize(WRITE)
    public LocalityAdminRow retire(@CurrentUser AuthPrincipal principal, @PathVariable String slug) {
        return localityService.retire(slug, principal);
    }

    @PostMapping(Routes.Localities.ADMIN_RESTORE)
    @PreAuthorize(WRITE)
    public LocalityAdminRow restore(@CurrentUser AuthPrincipal principal, @PathVariable String slug) {
        return localityService.restore(slug, principal);
    }
}