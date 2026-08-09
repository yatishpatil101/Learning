package com.punenest.api.moderation.user;

import com.punenest.api.common.validation.IndianMobile;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.UserResponse;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * User administration endpoints (contract tag {@code Moderation}).
 *
 * <p><strong>The staff/admin split here is the whole point of the slice.</strong> Reading users is
 * {@code [staff, admin]} — ops cannot help someone they cannot find. Everything that <em>changes</em>
 * a person's account (edit, suspend, reinstate) and everything that changes who holds power
 * ({@code addStaff}) is {@code [admin]}. Without that line, any staff account is one request away
 * from minting itself an admin colleague, which makes every other guard in the codebase decorative.
 */
@RestController
public class UserAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";

    private final UserAdminService service;

    public UserAdminController(UserAdminService service) {
        this.service = service;
    }

    /** {@code GET /users} (contract {@code listUsers}) — paged, mobile masked. */
    @GetMapping(Routes.Users.BASE)
    @PreAuthorize(STAFF_OR_ADMIN)
    public PageResponse<UserResponse> list(@RequestParam(required = false) String role,
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "false") boolean archived,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.list(role, q, archived, Pageables.unsorted(pageable)), dto -> dto);
    }

    /**
     * {@code POST /users/staff} (contract {@code addStaff}) — 201, admin only.
     *
     * <p>Declared before {@link #get} deliberately is <em>not</em> what makes this work — Spring
     * matches the literal {@code /users/staff} ahead of the {@code /users/{id}} template regardless
     * of declaration order. It is placed here only so the two are read together.
     */
    @PostMapping(Routes.Users.STAFF)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize(ADMIN_ONLY)
    public UserResponse addStaff(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody StaffCreateRequest body) {
        return service.addStaff(principal, body.name(), body.mobile(), body.email(), body.role(),
                body.team(), body.password());
    }

    /** {@code GET /users/{id}} (contract {@code getUser}) — unmasked mobile, audited. */
    @GetMapping(Routes.Users.BY_ID)
    @PreAuthorize(STAFF_OR_ADMIN)
    public UserResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /** {@code PATCH /users/{id}} (contract {@code adminUpdateUser}) — admin only. */
    @PatchMapping(Routes.Users.BY_ID)
    @PreAuthorize(ADMIN_ONLY)
    public UserResponse update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody UserPatchRequest body) {
        return service.update(principal, id, body.name(), body.email(), body.avatar());
    }

    /** {@code PATCH /users/{id}/archive} (contract {@code archiveUser}) — admin only. */
    @PatchMapping(Routes.Users.ARCHIVE)
    @PreAuthorize(ADMIN_ONLY)
    public void archive(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonBody body) {
        service.archive(principal, id, body == null ? null : body.reason());
    }

    /** {@code PATCH /users/{id}/restore} (contract {@code restoreUser}) — admin only. */
    @PatchMapping(Routes.Users.RESTORE)
    @PreAuthorize(ADMIN_ONLY)
    public void restore(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.restore(principal, id);
    }

    /**
     * Body of {@code addStaff} (schema {@code StaffCreate}).
     *
     * <p>The {@code mobile} pattern is the platform-wide {@code Mobile} schema, repeated here rather
     * than trusted from the client: this endpoint writes straight into a column with a matching
     * database CHECK, and a 400 with a field name is a better answer than a 500 from a constraint.
     */
    public record StaffCreateRequest(@NotBlank String name,
            @NotBlank @IndianMobile String mobile,
            @NotBlank @Email String email,
            @NotBlank String role, String team, String password) {
    }

    /** Body of {@code adminUpdateUser} (schema {@code UserUpdate}) — every field optional. */
    public record UserPatchRequest(String name, @Email String email, String avatar) {
    }

    /** Body of {@code archiveUser} (schema {@code ReasonRequest}). */
    public record ReasonBody(String reason) {
    }
}
