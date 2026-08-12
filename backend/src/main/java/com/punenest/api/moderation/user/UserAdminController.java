package com.punenest.api.moderation.user;

import com.punenest.api.common.validation.IndianMobile;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.UserResponse;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
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
 *
 * <p><strong>The same split again, per account</strong> (tech debt D192/D13): {@code users:read} and
 * {@code users:write} are {@code and}-ed onto those two role guards, so a moderator can be given the
 * directory without the ability to edit anyone, and an administrator can be given everything else in
 * the back office without the one route that mints colleagues. The atom never replaces the role
 * term — {@code users:write} in a staff account's document is dropped by the intersection in
 * {@code AccountPermissions} and would be refused by {@code hasRole('ADMIN')} even if it were not.
 */
@RestController
public class UserAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String USERS_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_USERS_READ;
    private static final String USERS_WRITE =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_WRITE;

    /**
     * The approval queue is admin-only even though it is a read (D200).
     *
     * <p>{@link #USERS_READ} admits staff, which is right for the directory — ops cannot help
     * somebody they cannot find. Who is waiting for a second key is a different subject: it is the
     * state of the platform's own trust decisions, and it names the administrators making them.
     * Sharing the route's role guard with {@code approve} keeps "see the queue" and "act on it"
     * inside one audience.
     */
    private static final String APPROVALS_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_READ;

    private final UserAdminService service;

    public UserAdminController(UserAdminService service) {
        this.service = service;
    }

    /** {@code GET /users} (contract {@code listUsers}) — paged, mobile masked. */
    @GetMapping(Routes.Users.BASE)
    @PreAuthorize(USERS_READ)
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
    @PreAuthorize(USERS_WRITE)
    public UserResponse addStaff(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody StaffCreateRequest body) {
        return service.addStaff(principal, body.name(), body.mobile(), body.email(), body.role(),
                body.team());
    }

    /** {@code GET /users/{id}} (contract {@code getUser}) — unmasked mobile, audited. */
    @GetMapping(Routes.Users.BY_ID)
    @PreAuthorize(USERS_READ)
    public UserResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /**
     * {@code GET /users/pending-approvals} (contract {@code listPendingStaffApprovals}) — the
     * accounts minted through {@link #addStaff} that still cannot sign in (D200).
     *
     * <p>Declared after {@link #get} for readability only; Spring matches the literal segment ahead
     * of the {@code /users/{id}} template regardless of order, the same way {@code /users/staff} is
     * matched.
     */
    @GetMapping(Routes.Users.PENDING_APPROVALS)
    @PreAuthorize(APPROVALS_READ)
    public List<UserResponse> pendingApprovals() {
        return service.pendingApprovals();
    }

    /**
     * {@code POST /users/{id}/approve} (contract {@code approveStaffAccount}) — the second key
     * (D200). Refused with 403 when the caller is the account's creator.
     */
    @PostMapping(Routes.Users.APPROVE)
    @PreAuthorize(USERS_WRITE)
    public UserResponse approve(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.approve(principal, id);
    }

    /** {@code PATCH /users/{id}} (contract {@code adminUpdateUser}) — admin only. */
    @PatchMapping(Routes.Users.BY_ID)
    @PreAuthorize(USERS_WRITE)
    public UserResponse update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody UserPatchRequest body) {
        return service.update(principal, id, body.name(), body.email(), body.avatar());
    }

    /** {@code PATCH /users/{id}/archive} (contract {@code archiveUser}) — admin only. */
    @PatchMapping(Routes.Users.ARCHIVE)
    @PreAuthorize(USERS_WRITE)
    public void archive(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonBody body) {
        service.archive(principal, id, body == null ? null : body.reason());
    }

    /** {@code PATCH /users/{id}/restore} (contract {@code restoreUser}) — admin only. */
    @PatchMapping(Routes.Users.RESTORE)
    @PreAuthorize(USERS_WRITE)
    public void restore(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.restore(principal, id);
    }

    /**
     * Body of {@code addStaff} (schema {@code StaffCreate}).
     *
     * <p>The {@code mobile} pattern is the platform-wide {@code Mobile} schema, repeated here rather
     * than trusted from the client: this endpoint writes straight into a column with a matching
     * database CHECK, and a 400 with a field name is a better answer than a 500 from a constraint.
     *
     * <p><strong>There is deliberately no {@code password} field</strong> (tech debt D206). It used
     * to carry one, which meant the administrator who minted an account also chose the credential it
     * would sign in with — so the second administrator's co-signature attested to a record rather
     * than to a person, and the maker could sign in as the colleague they had just had approved. The
     * account is now created with no usable password, and the person it belongs to sets their own
     * through {@code POST /auth/staff-invite/redeem}. Note that a client still sending {@code
     * password} gets no error: Jackson ignores the unknown property. That is worth saying out loud,
     * because it means a stale console quietly stops setting a password rather than failing — but
     * the account it creates could not authenticate on that password either way.
     */
    public record StaffCreateRequest(@NotBlank String name,
            @NotBlank @IndianMobile String mobile,
            @NotBlank @Email String email,
            @NotBlank String role, String team) {
    }

    /** Body of {@code adminUpdateUser} (schema {@code UserUpdate}) — every field optional. */
    public record UserPatchRequest(String name, @Email String email, String avatar) {
    }

    /** Body of {@code archiveUser} (schema {@code ReasonRequest}). */
    public record ReasonBody(String reason) {
    }
}
