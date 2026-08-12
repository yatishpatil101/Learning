package com.punenest.api.admin;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/settings} — read and merge the platform configuration document.
 *
 * <p><strong>Admin only, both verbs.</strong> The read is restricted as tightly as the write because
 * the document contains the fee table and the permission map: knowing exactly what the platform
 * charges and which team may do what is itself a privileged answer.
 *
 * <p>The body is a free-form {@code Map} rather than a typed record on purpose. {@code AdminSettings}
 * declares {@code additionalProperties: true} on {@code site}, {@code fees}, {@code permissions} and
 * {@code movePack}, so binding it to a record would silently drop every key the record did not name
 * — and a settings endpoint that discards what it was sent is worse than one that stores something
 * it does not understand.
 *
 * <p><strong>Both verbs additionally require a per-account atom</strong> (tech debt D192/D13),
 * {@code and}-ed onto the role guard rather than replacing it. The two are separate names because
 * the split is the one an ops lead actually asks for: an administrator who may audit the fee table
 * without being able to change it is a real position, and it cannot be expressed by a role.
 * Read and write are separately revocable and neither can be granted to a non-administrator, since
 * the role guard is still the first term.
 */
@RestController
public class AdminSettingsController {

    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String SETTINGS_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_SETTINGS_READ;
    private static final String SETTINGS_WRITE =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_SETTINGS_WRITE;

    private final AdminSettingsService service;

    public AdminSettingsController(AdminSettingsService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/settings} (contract {@code getAdminSettings}).
     *
     * <p>Carries an {@code ETag} so the admin screen can make its next save conditional (S68).
     * Computed inside the same read as the document, so the tag always describes the body it
     * travelled with.
     */
    @GetMapping(Routes.Admin.SETTINGS)
    @PreAuthorize(SETTINGS_READ)
    public ResponseEntity<Map<String, Object>> current() {
        SettingsDocument settings = service.current();
        return ResponseEntity.ok().eTag(settings.etag()).body(settings.body());
    }

    /**
     * {@code PUT /admin/settings} (contract {@code updateAdminSettings}) — a merge, per S60.
     *
     * <p>Returns the whole stored document, not the patch: after merging, what is stored is not what
     * was sent, and an admin editing money must be shown the result rather than their own input.
     *
     * <p>{@code If-Match} is optional (S68). Supplying the ETag from a previous read turns the write
     * into a compare-and-set that answers {@code 412} instead of quietly overwriting a colleague;
     * omitting it keeps the pre-S68 behaviour, which is what stops this from breaking every existing
     * caller the day it shipped.
     */
    @PutMapping(Routes.Admin.SETTINGS)
    @PreAuthorize(SETTINGS_WRITE)
    public ResponseEntity<Map<String, Object>> update(@CurrentUser AuthPrincipal principal,
            @RequestHeader(value = HttpHeaders.IF_MATCH, required = false) String ifMatch,
            @RequestBody Map<String, Object> patch) {
        SettingsDocument saved = service.update(principal, patch, ifMatch);
        return ResponseEntity.ok().eTag(saved.etag()).body(saved.body());
    }
}
