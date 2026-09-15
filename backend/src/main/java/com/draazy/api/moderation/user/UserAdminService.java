package com.draazy.api.moderation.user;

import com.draazy.api.common.access.StaffAccountApproval;
import com.draazy.api.common.access.StaffAccountApprovalRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.auth.StaffInviteService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserMapper;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserResponse;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.PermissionMap;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * User administration — the back-office surface over other people's accounts. The list masks
 * mobiles; the single-user read reveals and audits. Rationale: docs/flows/admin/users-kyc.md#user-administration.
 */
@Service
public class UserAdminService {

    /** Roles an admin may mint via {@code POST /users/staff}. */
    private static final Set<String> STAFF_ROLES = Set.of(Roles.Wire.STAFF, Roles.Wire.ADMIN);

    private final UserRepository users;
    private final UserMapper mapper;
    private final AuditService audit;
    private final AdministratorGuard administrators;
    private final StaffAccountApprovalRepository approvals;
    private final StaffInviteService invites;
    /** Lookup and the masked/full wire projection, shared with {@link UserModerationService}. */
    private final BackOfficeUserView view;

    public UserAdminService(UserRepository users, UserMapper mapper,
            AuditService audit, AdministratorGuard administrators,
            StaffAccountApprovalRepository approvals, StaffInviteService invites,
            BackOfficeUserView view) {
        this.users = users;
        this.mapper = mapper;
        this.audit = audit;
        this.administrators = administrators;
        this.approvals = approvals;
        this.invites = invites;
        this.view = view;
    }

    /**
     * {@code GET /users} — paged, mobile masked. No audit row: it reveals nothing unmasked, and
     * logging every list page would bury the reads that actually matter.
     */
    @Transactional(readOnly = true)
    public Page<UserResponse> list(String role, String q, String status, Boolean flagged,
            boolean archived, Pageable pageable) {
        String prefix = (q == null || q.isBlank()) ? null : likePrefix(q.trim().toLowerCase());
        String state = (status == null || status.isBlank()) ? null : status.trim();
        return users.searchForAdmin(role, prefix, state, flagged, archived, pageable)
                .map(this::masked);
    }

    /**
     * Turn a search term into an anchored LIKE pattern, neutralising the caller's own wildcards —
     * {@code ?q=%} would otherwise be an unanchored scan of every user. Escape char matches the query.
     */
    private static String likePrefix(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    /**
     * {@code GET /users/{id}} — full detail including the unmasked mobile. The audit row is written
     * before the response is built so a reveal cannot succeed unlogged.
     */
    @Transactional
    public UserResponse get(AuthPrincipal actor, String id) {
        User user = load(id);
        audit.record(actor, "user.contact.reveal", "user", id, "mobile", MobileMask.mask(user.getMobile()));
        return view.full(user);
    }

    /**
     * {@code PATCH /users/{id}} — admin-only profile correction. Email collisions are caught here,
     * case-insensitively, so the operator sees a named field rather than a generic index conflict.
     */
    @Transactional
    public UserResponse update(AuthPrincipal actor, String id, String name, String email, String avatar) {
        User user = load(id);
        if (name != null && !name.isBlank()) {
            user.setName(name.trim());
        }
        if (email != null && !email.isBlank()) {
            String address = email.trim();
            if (users.existsOtherLiveWithEmailIgnoreCase(address, user.getId())) {
                throw new ConflictException("A user with that email already exists");
            }
            user.setEmail(address);
        }
        if (avatar != null && !avatar.isBlank()) {
            user.setAvatar(avatar.trim());
        }
        audit.record(actor, "user.update", "user", id, "name", name, "email", email, "avatar", avatar);
        return view.full(user);
    }

    /**
     * {@code PATCH /users/{id}/archive} — suspend a person. Neither self nor the last administrator:
     * restore is admin-only, so either would lock the platform out of its own back office.
     */
    @Transactional
    public void archive(AuthPrincipal actor, String id, String reason) {
        User user = load(id);
        if (actor.userId().equals(user.getId())) {
            throw new ForbiddenException("You cannot archive your own account");
        }
        administrators.refuseIfLastAdministrator(user);
        user.archive(reason);
        audit.record(actor, "user.archive", "user", id, "reason", reason, "role", user.getRole());
    }

    /**
     * {@code PATCH /users/{id}/restore} — reinstate a suspended person. Refused when the address is
     * now held live: two live rows break staff login with a 500 nothing in the console can undo.
     */
    @Transactional
    public void restore(AuthPrincipal actor, String id) {
        User user = load(id);
        refuseIfEmailIsHeldByALiveAccount(user);
        user.restore();
        audit.record(actor, "user.restore", "user", id, "role", user.getRole());
    }

    /**
     * Refuse a restore that would leave two live accounts sharing an email address. Case-insensitive,
     * matching the index; an account with no email has nothing to collide on.
     */
    private void refuseIfEmailIsHeldByALiveAccount(User user) {
        String email = user.getEmail();
        if (email == null || email.isBlank()) {
            return;
        }
        if (users.existsOtherLiveWithEmailIgnoreCase(email, user.getId())) {
            throw new ConflictException(
                    "Another active account already uses " + email + ". Archive or change the email "
                            + "on that account first, then restore this one.");
        }
    }

    /**
     * {@code POST /users/staff} — privilege escalation, admin only. No password is ever set here;
     * the account is held for a second administrator. Rationale: docs/flows/admin/settings-team-staff.md#staff-account-creation.
     */
    @Transactional
    public UserResponse addStaff(AuthPrincipal actor, String name, String mobile, String email,
            String role, String team) {
        // @IndianMobile validated the shape; canonicalise so the dedup check and the stored row key
        // off the same ten digits the column CHECK enforces.
        mobile = MobileMask.normalise(mobile);
        if (!STAFF_ROLES.contains(role)) {
            throw new ForbiddenException("Staff accounts may only be created with role staff or admin");
        }
        team = team == null || team.isBlank() ? null : team.trim();
        if (Roles.Wire.STAFF.equals(role) && !Teams.isKnown(team)) {
            throw new ValidationException("A staff account must name a team. Expected one of "
                    + Teams.known() + ".");
        }
        if (Roles.Wire.ADMIN.equals(role) && team != null) {
            throw new ValidationException("An administrator is not on a team; omit 'team'.");
        }
        if (users.existsByMobile(mobile)) {
            throw new ConflictException("A user with that mobile already exists");
        }
        if (users.existsByEmailIgnoreCaseAndArchivedFalse(email)) {
            throw new ConflictException("A user with that email already exists");
        }
        User user = new User(mobile, role);
        user.setName(name.trim());
        user.setEmail(email.trim());
        user.setTeam(team);
        // No password is set, and none can be — the holder activates via the invite below.
        // Decided BEFORE the insert: the account being created must not count itself as approver.
        boolean needsApproval = administrators.approvalIsPossible(actor.userId());
        // saveAndFlush, not save: the approval row's FK names this id, and the insert below has to
        // land after the user row exists rather than in whatever order the flush happens to pick.
        User saved = users.saveAndFlush(user);
        if (needsApproval) {
            approvals.save(new StaffAccountApproval(saved.getId(), actor.userId()));
        }
        // Same transaction as the account, so there is no window in which a passwordless account
        // exists with nothing holding it shut. The raw token goes to `mobile` and is not returned.
        invites.issue(saved.getId(), mobile, actor.userId());
        audit.record(actor, needsApproval ? "user.staff.create" : "user.staff.create.bootstrap",
                "user", saved.getId().toString(),
                "email", email, "role", role, "team", team);
        return mapper.toResponse(saved);
    }

    /**
     * {@code GET /users/pending-approvals} — accounts that cannot yet sign in. Unpaged, and mobiles
     * masked like {@link #list}: a queue screen is not a bulk-reveal surface.
     */
    @Transactional(readOnly = true)
    public List<UserResponse> pendingApprovals() {
        return approvals.findByApprovedAtIsNullOrderByCreatedAtAsc().stream()
                .map(StaffAccountApproval::getUserId)
                .map(users::findById)
                .flatMap(Optional::stream)
                .map(this::masked)
                .toList();
    }

    /**
     * {@code POST /users/{id}/approve} — the second key. Approver may not be the maker and must
     * still be live. Rationale: docs/flows/admin/settings-team-staff.md#staff-account-creation.
     */
    @Transactional
    public UserResponse approve(AuthPrincipal actor, String id) {
        // Deliberately not AdministratorGuard.isCapable, which also excludes accounts awaiting
        // approval — unreachable here, since such an account cannot obtain a token.
        users.findByIdAndArchivedFalse(actor.userId())
                .orElseThrow(() -> new ForbiddenException(
                        "This account is no longer active and cannot approve colleagues."));
        User target = load(id);
        StaffAccountApproval approval = approvals.findById(target.getId())
                .orElseThrow(() -> new ConflictException(
                        "This account is not waiting for approval — it can already sign in."));
        if (approval.isApproved()) {
            throw new ConflictException("This account has already been approved.");
        }
        if (approval.getCreatedBy().equals(actor.userId())) {
            audit.record(actor, "user.staff.approve.refused", "user", target.getId().toString(),
                    "reason", "checker is maker", "role", target.getRole());
            throw new ForbiddenException(
                    "An account must be approved by an administrator other than the one who "
                            + "created it. Ask a colleague to approve this one.");
        }
        approval.approve(actor.userId());
        approvals.save(approval);
        audit.record(actor, "user.staff.approve", "user", target.getId().toString(),
                "createdBy", approval.getCreatedBy().toString(), "role", target.getRole());
        return masked(target);
    }

    /** Mask the mobile on the wire without touching the managed entity. */
    private UserResponse masked(User user) {
        return view.masked(user);
    }

    private User load(String id) {
        return view.load(id);
    }
}
