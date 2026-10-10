package com.draazy.api.admin;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Admin only on both verbs: the document holds the fee table and permission map. The body is a free-form
 * {@code Map} because {@code additionalProperties: true} blocks would lose unnamed keys in a record. */
@RestController
public class AdminSettingsController {

    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String BACK_OFFICE = "hasAnyRole('" + Roles.STAFF + "', '" + Roles.MANAGER + "', '"
            + Roles.ADMIN + "')";
    private static final String SETTINGS_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_SETTINGS_READ;
    private static final String SETTINGS_WRITE =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_SETTINGS_WRITE;

    private final AdminSettingsService service;

    public AdminSettingsController(AdminSettingsService service) {
        this.service = service;
    }

    /** Carries an {@code ETag} computed in the same read as the body, so the tag always describes it. */
    @GetMapping(Routes.Admin.SETTINGS)
    @PreAuthorize(SETTINGS_READ)
    public ResponseEntity<Map<String, Object>> current() {
        SettingsDocument settings = service.current();
        return ResponseEntity.ok().eTag(settings.etag()).body(settings.body());
    }

    /** Only the module switches, so the shell does not download the fee table and permission map on every page. */
    @GetMapping(Routes.Admin.SETTINGS_FLAGS)
    @PreAuthorize(BACK_OFFICE)
    public Map<String, Object> flags() {
        return service.adminFlags();
    }

    /** Returns the stored result of each written block, not the patch: after merging, stored differs from sent.
     * {@code If-Match} is optional; when supplied it answers {@code 412} instead of overwriting a colleague. */
    @PutMapping(Routes.Admin.SETTINGS)
    @PreAuthorize(SETTINGS_WRITE)
    public ResponseEntity<Map<String, Object>> update(@CurrentUser AuthPrincipal principal,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @RequestBody Map<String, Object> patch) {
        SettingsDocument saved = service.update(principal, patch, ifMatch);
        return ResponseEntity.ok().eTag(saved.etag()).body(saved.body());
    }
}
