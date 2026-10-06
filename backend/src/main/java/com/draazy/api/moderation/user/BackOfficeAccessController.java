package com.draazy.api.moderation.user;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficeFunctions;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** Editing who may do what is the same privilege as minting a colleague, so it sits behind the {@code users:write} atom
 * of {@code POST /users/staff}; {@code BackOfficeAccessService} refuses a self-edit. */
@RestController
public class BackOfficeAccessController {

    private static final String MANAGER_OR_ADMIN =
            "hasAnyRole('" + Roles.MANAGER + "', '" + Roles.ADMIN + "')";
    private static final String ACCESS_READ =
            MANAGER_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_USERS_READ;
    private static final String ACCESS_WRITE =
            MANAGER_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_USERS_WRITE;

    private final BackOfficeAccessService service;

    public BackOfficeAccessController(BackOfficeAccessService service) {
        this.service = service;
    }

    @GetMapping(Routes.Admin.FUNCTION_CATALOGUE)
    @PreAuthorize(ACCESS_READ)
    public List<BackOfficeFunctions.Function> functionCatalogue() {
        return service.functionCatalogue();
    }

    /** {@code GET /users/{id}/permissions} — what is stored, and what it resolves to. */
    @GetMapping(Routes.Users.PERMISSIONS)
    @PreAuthorize(ACCESS_READ)
    public BackOfficeAccessResponse read(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.read(principal, id);
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
        return service.replace(principal, id, body == null ? List.of() : body.functionsOrPermissions());
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
    public record PermissionsRequest(List<String> functions, List<String> permissions) {
        List<String> functionsOrPermissions() {
            return functions == null ? permissions : functions;
        }
    }
}
