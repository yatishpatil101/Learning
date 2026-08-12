package com.punenest.api.moderation.user;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The server-side half of Team &amp; Access (tech debt D192/D13).
 *
 * <p>Before this, {@code roleId} and {@code moduleAccess} were session fields the admin client
 * invented at mock login and kept in browser storage; {@code V61} deleted the one thing that had
 * reached the database. These three routes are what make the console's grid describe something the
 * server will honour: a catalogue it must render from, a read of what is stored, and a write that
 * refuses anything outside the catalogue.
 *
 * <p><strong>Admin only, plus {@code users:write} for the write and {@code users:read} for the two
 * reads.</strong> Editing who may do what is the same privilege as minting a colleague, so it sits
 * behind the same atom as {@code POST /users/staff} rather than gaining one of its own — a
 * separately revocable "may edit permissions" would be an administrator who cannot create an admin
 * but can grant themselves… nothing, because {@code BackOfficeAccessService} refuses a
 * self-edit. One atom, one story.
 *
 * <p>Separate from {@link UserAdminController} because the resource is different: that controller
 * serves the account, this one serves the account's access, and the two have different bodies,
 * different failure modes and — after the next slice — probably different audiences.
 */
@RestController
public class BackOfficeAccessController {

    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String ACCESS_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_READ;
    private static final String ACCESS_WRITE =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_WRITE;

    private final BackOfficeAccessService service;

    public BackOfficeAccessController(BackOfficeAccessService service) {
        this.service = service;
    }

    /**
     * {@code GET /admin/permission-catalogue} — every atom the server enforces.
     *
     * <p>Served rather than hard-coded in the console so the grid cannot offer a permission the
     * server would ignore. That divergence is the whole of {@code V61}: the client composed bundles
     * from its own module list, the server spoke a different vocabulary, and the document in between
     * granted nothing while looking like policy.
     */
    @GetMapping(Routes.Admin.PERMISSION_CATALOGUE)
    @PreAuthorize(ACCESS_READ)
    public List<BackOfficePermissions.Permission> catalogue() {
        return service.catalogue();
    }

    /** {@code GET /users/{id}/permissions} — what is stored, and what it resolves to. */
    @GetMapping(Routes.Users.PERMISSIONS)
    @PreAuthorize(ACCESS_READ)
    public BackOfficeAccessResponse read(@PathVariable String id) {
        return service.read(id);
    }

    /**
     * {@code PUT /users/{id}/permissions} — replace the document.
     *
     * <p>A {@code PUT} of the whole list rather than a {@code PATCH} of a delta, because the caller
     * is stating the access this account should have. Returns the stored result rather than echoing
     * the request: after the write, what the account can do is the <em>intersection</em> of this list
     * with its role baseline, and an administrator editing access must be shown the outcome.
     */
    @PutMapping(Routes.Users.PERMISSIONS)
    @PreAuthorize(ACCESS_WRITE)
    public BackOfficeAccessResponse replace(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @RequestBody PermissionsRequest body) {
        return service.replace(principal, id, body == null ? List.of() : body.permissions());
    }

    /**
     * The write body.
     *
     * <p>{@code List<String>} rather than a richer shape: the catalogue is served separately, so the
     * client has no reason to send back the module and action it was given, and a field the server
     * ignores is a field a client will one day rely on. Names are validated against the catalogue in
     * the service, where the account's role is known — the ceiling is per-role, so this is not a rule
     * Bean Validation could have expressed.
     */
    public record PermissionsRequest(List<String> permissions) {
    }
}
