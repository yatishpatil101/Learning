package com.punenest.api.moderation.user;

import com.punenest.api.common.error.ValidationException;
import com.punenest.api.common.validation.IndianMobile;
import com.punenest.api.common.web.PageResponse;
import com.punenest.api.common.web.Pageables;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.UserResponse;
import com.punenest.api.identity.user.UserStatuses;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.BackOfficePermissions;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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

    /**
     * The activity timeline is admin-only for a reason that is not obvious (V77).
     *
     * <p>It is a read, and {@code users:read} would be the natural atom — but one arm of the union
     * is the audit log, and {@code audit:read} is one of the six admin-only atoms. Serving the
     * timeline under {@link #USERS_READ} would hand a staff account moderation history it is refused
     * at {@code GET /admin/audit-log}, which is the same data through a door nobody thought to lock.
     * The permission atom stays {@code users:read} so a read-only administrator can still look;
     * only the role term is raised.
     */
    private static final String TIMELINE_READ =
            ADMIN_ONLY + " and " + BackOfficePermissions.REQUIRE_USERS_READ;

    private final UserAdminService service;
    /** The V77 actions: suspension, badge, review flag. Split out at the use-case seam. */
    private final UserModerationService moderation;

    public UserAdminController(UserAdminService service, UserModerationService moderation) {
        this.service = service;
        this.moderation = moderation;
    }

    /**
     * {@code GET /users} (contract {@code listUsers}) — paged, mobile masked.
     *
     * <p>{@code status} and {@code archived} are separate parameters because they are separate
     * columns: an account can be suspended and archived at once, and a moderator working the
     * suspension queue wants the live ones. Folding them into a single "state" would make that
     * queue inexpressible.
     *
     * <p>{@code status} is validated rather than passed through, even though an unknown value would
     * simply match nothing. "Zero results" is the same answer a legitimate empty filter gives, so a
     * console with a typo in a dropdown would look like a working screen reporting an empty
     * platform, and the bug would be found by a user rather than by the request that caused it.
     */
    @GetMapping(Routes.Users.BASE)
    @PreAuthorize(USERS_READ)
    public PageResponse<UserResponse> list(@RequestParam(required = false) String role,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean flagged,
            @RequestParam(defaultValue = "false") boolean archived,
            @PageableDefault(size = 20) Pageable pageable) {
        if (status != null && !status.isBlank() && !UserStatuses.ALL.contains(status)) {
            throw new ValidationException("Unknown status '" + status + "'. Expected one of "
                    + "active, suspended, archived.");
        }
        return PageResponse.of(
                service.list(role, q, status, flagged, archived, Pageables.unsorted(pageable)),
                dto -> dto);
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
     * {@code PATCH /users/{id}/suspend} (contract {@code suspendUser}) — admin only.
     *
     * <p>Answers 200 with no body, matching {@link #archive} and {@link #restore} rather than the
     * 204 a void action would otherwise suggest. Not because 200 is better — it is that these four
     * are the same kind of thing to the console, which handles them through one code path, and a
     * lone 204 among them is a trap for the next person to add a route here.
     *
     * <p>No body for a second reason: the console re-reads the directory after a moderation action
     * anyway, and handing one back would invite it to trust a single row's copy of a state that also
     * killed the person's sessions.
     */
    @PatchMapping(Routes.Users.SUSPEND)
    @PreAuthorize(USERS_WRITE)
    public void suspend(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody(required = false) ReasonBody body) {
        moderation.suspend(principal, id, body == null ? null : body.reason());
    }

    /** {@code PATCH /users/{id}/reactivate} (contract {@code reactivateUser}) — admin only. */
    @PatchMapping(Routes.Users.REACTIVATE)
    @PreAuthorize(USERS_WRITE)
    public void reactivate(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        moderation.reactivate(principal, id);
    }

    /**
     * {@code PATCH /users/{id}/badge} (contract {@code setUserBadge}) — admin only.
     *
     * <p>Unlike the two above this <em>does</em> answer with the user, because the badge is a field
     * the directory renders and the caller has just changed it — there is nothing else to re-read.
     */
    @PatchMapping(Routes.Users.BADGE)
    @PreAuthorize(USERS_WRITE)
    public UserResponse setBadge(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody BadgeRequest body) {
        return moderation.setBadge(principal, id, body.granted(), body.reason());
    }

    /** {@code PATCH /users/{id}/flag} (contract {@code setUserFlag}) — admin only. */
    @PatchMapping(Routes.Users.FLAG)
    @PreAuthorize(USERS_WRITE)
    public UserResponse setFlag(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody FlagRequest body) {
        return moderation.setFlag(principal, id, body.flagged(), body.reason());
    }

    /**
     * {@code GET /users/{id}/timeline} (contract {@code getUserTimeline}) — admin only.
     *
     * <p><strong>{@code users:read}, not {@code users:write}</strong> — it is a read, and gating it
     * behind the write permission would mean an administrator who may look at an account but not
     * act on it cannot see why they might want to. The <em>role</em> term is raised to admin all the
     * same; see {@link #TIMELINE_READ}.
     *
     * <p><strong>But it is not audited, unlike {@link #get}.</strong> That asymmetry is deliberate:
     * the audited route reveals a phone number, and this one reveals no contact detail at all — it
     * carries ids, timestamps, statuses and titles the caller can already see elsewhere in the
     * console. Logging it would file a record for every click of a modal, burying the reads that
     * actually expose something personal.
     */
    @GetMapping(Routes.Users.TIMELINE)
    @PreAuthorize(TIMELINE_READ)
    public List<UserTimelineEntry> timeline(@PathVariable String id) {
        return moderation.timeline(id);
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

    /**
     * Body of {@code setUserBadge} (schema {@code UserBadgeRequest}).
     *
     * <p>{@code granted} is a boxed {@link Boolean} with {@code @NotNull} rather than a primitive so
     * that an omitted field is a 422 naming the field. A primitive would default to {@code false},
     * which reads as "withdraw this person's badge" — the most destructive of the two outcomes,
     * reached by saying nothing.
     *
     * <p>{@code reason} is required in both directions, and this is the one place it is required to
     * revoke as well as to grant: the badge is what buyers use to decide who to trust, so both
     * halves of the decision have to be answerable later out of {@code audit_log}.
     */
    public record BadgeRequest(@NotNull Boolean granted, @NotBlank String reason) {
    }

    /**
     * Body of {@code setUserFlag} (schema {@code UserFlagRequest}).
     *
     * <p>{@code reason} is optional <em>here</em> and mandatory in the service when {@code flagged}
     * is true, because Bean Validation cannot express "required only when another field is true"
     * without a class-level constraint that would report the error against the object rather than
     * the field. The service check is the one that produces a usable message; V77's CHECK is the one
     * that guarantees it.
     */
    public record FlagRequest(@NotNull Boolean flagged, String reason) {
    }
}
