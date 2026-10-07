package com.draazy.api.moderation.user;

import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.validation.IndianMobile;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.UserResponse;
import com.draazy.api.identity.user.UserStatuses;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

// User administration endpoints (contract tag Moderation).
@RestController
public class UserAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String MANAGER_OR_ADMIN =
            "hasAnyRole('" + Roles.MANAGER + "', '" + Roles.ADMIN + "')";
    private static final String ADMIN_ONLY = "hasRole('" + Roles.ADMIN + "')";
    private static final String USERS_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_USERS_READ;
    private static final String TEAM_WRITE =
            MANAGER_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_USERS_WRITE;
    private static final String ADMIN_WRITE =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_WRITE;
    private static final String KYC_EDIT =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_IDENTITY_WRITE;

    // Admin-only because one timeline arm reads the audit log.
    private static final String TIMELINE_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_READ;

    private final UserAdminService service;

    private final UserModerationService moderation;
    private final BadgeGrantService badgeGrants;

    public UserAdminController(UserAdminService service, UserModerationService moderation,
            BadgeGrantService badgeGrants) {
        this.service = service;
        this.moderation = moderation;
        this.badgeGrants = badgeGrants;
    }

    // status and archived are separate because an account can be suspended and archived.
    // customers=true narrows to owners and buyers; back-office accounts live under Team & Access.
    @GetMapping(Routes.Users.BASE)
    @PreAuthorize(USERS_READ)
    public PageResponse<UserResponse> list(@RequestParam(required = false) String role,
            @RequestParam(defaultValue = "false") boolean customers,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean flagged,
            @RequestParam(defaultValue = "false") boolean archived,
            @RequestParam(defaultValue = "false") boolean counts,
            @PageableDefault(size = 20) Pageable pageable) {
        if (status != null && !status.isBlank() && !UserStatuses.ALL.contains(status)) {
            throw new ValidationException("Unknown status '" + status + "'. Expected one of "
                    + "active, suspended, archived.");
        }
        PageResponse<UserResponse> page = PageResponse.of(
                service.list(role, customers, q, status, flagged, archived,
                        Pageables.unsorted(pageable)),
                dto -> dto);
        return counts ? page.withCounts(service.statusCounts(role, customers, q)) : page;
    }

    // Literal /users/staff is safe because Spring matches it ahead of the /users/{id} template.
    @PostMapping(Routes.Users.STAFF)
    @PreAuthorize(TEAM_WRITE)
    public ResponseEntity<StaffCreateResponse> addStaff(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody StaffCreateRequest body) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(service.addStaff(principal, body.name(), body.mobile(), body.email(), body.role(),
                        body.functions()));
    }

    /** {@code GET /users/{id}} (contract {@code getUser}) — audited single-user read. */
    @GetMapping(Routes.Users.BY_ID)
    @PreAuthorize(USERS_READ)
    public UserResponse get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    @PostMapping(Routes.Users.RESET_TWO_FACTOR)
    @PreAuthorize(TEAM_WRITE)
    public void resetTwoFactor(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.resetSecondFactor(principal, id);
    }

    @PostMapping(Routes.Users.REISSUE_INVITE)
    @PreAuthorize(TEAM_WRITE)
    public ResponseEntity<StaffInviteResponse> reissueInvite(@CurrentUser AuthPrincipal principal,
            @PathVariable String id) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.reissueInvite(principal, id));
    }

    /** {@code PATCH /users/{id}} (contract {@code adminUpdateUser}). */
    @PatchMapping(Routes.Users.BY_ID)
    @PreAuthorize(TEAM_WRITE)
    public UserResponse update(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody UserPatchRequest body) {
        return service.update(principal, id, body.name(), body.email(), body.avatar());
    }

    @PatchMapping(Routes.Users.KYC_PROFILE)
    @PreAuthorize(KYC_EDIT)
    public UserResponse updateForKyc(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody UserPatchRequest body) {
        return service.updateForKyc(principal, id, body.name(), body.email());
    }

    /** {@code PATCH /users/{id}/archive} (contract {@code archiveUser}). */
    @PatchMapping(Routes.Users.ARCHIVE)
    @PreAuthorize(TEAM_WRITE)
    public void archive(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonBody body) {
        service.archive(principal, id, body == null ? null : body.reason());
    }

    /** {@code PATCH /users/{id}/restore} (contract {@code restoreUser}). */
    @PatchMapping(Routes.Users.RESTORE)
    @PreAuthorize(TEAM_WRITE)
    public void restore(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.restore(principal, id);
    }

    // 200 with no body to match archive and restore.
    @PatchMapping(Routes.Users.SUSPEND)
    @PreAuthorize(TEAM_WRITE)
    public void suspend(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonBody body) {
        moderation.suspend(principal, id, body == null ? null : body.reason());
    }

    /** {@code PATCH /users/{id}/reactivate} (contract {@code reactivateUser}). */
    @PatchMapping(Routes.Users.REACTIVATE)
    @PreAuthorize(TEAM_WRITE)
    public void reactivate(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        moderation.reactivate(principal, id);
    }

    @PatchMapping(Routes.Users.BADGE)
    @PreAuthorize(ADMIN_WRITE)
    public ResponseEntity<Object> setBadge(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody BadgeRequest body) {
        Object response = moderation.setBadge(principal, id, body.granted(), body.reason());
        return body.granted()
                ? ResponseEntity.accepted().body(response)
                : ResponseEntity.ok(response);
    }

    @GetMapping(Routes.Admin.BADGE_GRANTS)
    @PreAuthorize(ADMIN_WRITE)
    public PageResponse<BadgeGrantResponse> badgeGrants(
            @RequestParam(defaultValue = BadgeGrantStatuses.PENDING) String status,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                badgeGrants.list(status, Pageables.unsorted(pageable)),
                dto -> dto);
    }

    @PostMapping(Routes.Admin.BADGE_GRANT_APPROVE)
    @PreAuthorize(ADMIN_WRITE)
    public BadgeGrantResponse approveBadgeGrant(@CurrentUser AuthPrincipal principal,
            @PathVariable String id,
            @Valid @RequestBody(required = false) BadgeGrantDecisionRequests.Approve body) {
        return badgeGrants.approve(principal, id, body == null ? null : body.note());
    }

    @PostMapping(Routes.Admin.BADGE_GRANT_REJECT)
    @PreAuthorize(ADMIN_WRITE)
    public BadgeGrantResponse rejectBadgeGrant(@CurrentUser AuthPrincipal principal,
            @PathVariable String id,
            @Valid @RequestBody BadgeGrantDecisionRequests.Reject body) {
        return badgeGrants.reject(principal, id, body.reason());
    }

    /** {@code PATCH /users/{id}/flag} (contract {@code setUserFlag}) — admin only. */
    @PatchMapping(Routes.Users.FLAG)
    @PreAuthorize(ADMIN_WRITE)
    public UserResponse setFlag(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody FlagRequest body) {
        return moderation.setFlag(principal, id, body.flagged(), body.reason());
    }

    // Uses users:read, not users:write, because it reveals activity rather than changing it.
    @GetMapping(Routes.Users.TIMELINE)
    @PreAuthorize(TIMELINE_READ)
    public List<UserTimelineEntry> timeline(@PathVariable String id) {
        return moderation.timeline(id);
    }

    public record StaffCreateRequest(@NotBlank String name,
            @NotBlank @IndianMobile String mobile,
            @NotBlank @Email String email,
            @NotBlank String role, List<String> functions) {
    }

    public record UserPatchRequest(@Size(max = 80) String name, @Email @Size(max = 254) String email, String avatar) {
    }

    public record ReasonBody(String reason) {
    }

    // Boxed Boolean gives an omitted field a named 422.
    public record BadgeRequest(@NotNull Boolean granted,
            @NotBlank @Size(min = 10, max = 300) String reason) {
    }

    // reason is conditional, which Bean Validation cannot express without a class-level validator.
    public record FlagRequest(@NotNull Boolean flagged, String reason) {
    }
}
