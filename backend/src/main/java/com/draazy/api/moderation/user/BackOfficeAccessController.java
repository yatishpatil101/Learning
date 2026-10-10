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
    private static final String ASSIGNEES_READ =
            MANAGER_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_TICKETS_READ;

    private final BackOfficeAccessService service;

    public BackOfficeAccessController(BackOfficeAccessService service) {
        this.service = service;
    }

    @GetMapping(Routes.Admin.FUNCTION_CATALOGUE)
    @PreAuthorize(ACCESS_READ)
    public List<BackOfficeFunctions.Function> functionCatalogue() {
        return service.functionCatalogue();
    }

    @GetMapping(Routes.Admin.TEAM)
    @PreAuthorize(ACCESS_READ)
    public List<TeamMemberResponse> team(@CurrentUser AuthPrincipal principal) {
        return service.roster(principal);
    }

    /** The ticket board's assignee picker; {@code users:read} is not needed to hand a ticket to a colleague. */
    @GetMapping(Routes.Admin.TEAM_ASSIGNEES)
    @PreAuthorize(ASSIGNEES_READ)
    public List<TeamAssignee> assignees(@CurrentUser AuthPrincipal principal) {
        return service.assignees(principal);
    }

    /** {@code GET /users/{id}/permissions} — what is stored, and what it resolves to. */
    @GetMapping(Routes.Users.PERMISSIONS)
    @PreAuthorize(ACCESS_READ)
    public BackOfficeAccessResponse read(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.read(principal, id);
    }

    /** {@code PUT} replaces the whole list and returns the stored result, as effective access is its
     * intersection with the role baseline. */
    @PutMapping(Routes.Users.PERMISSIONS)
    @PreAuthorize(ACCESS_WRITE)
    public BackOfficeAccessResponse replace(@CurrentUser AuthPrincipal principal,
            @PathVariable String id, @RequestBody PermissionsRequest body) {
        return service.replace(principal, id, body == null ? List.of() : body.functionsOrPermissions());
    }

    /** Plain strings because the catalogue is served separately; the service validates names, as only it
     * knows the account's role ceiling. */
    public record PermissionsRequest(List<String> functions, List<String> permissions) {
        List<String> functionsOrPermissions() {
            return functions == null ? permissions : functions;
        }
    }
}
