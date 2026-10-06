package com.draazy.api.moderation.user;

import com.draazy.api.common.access.BackOfficeGrant;
import com.draazy.api.common.access.BackOfficeGrantRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.identity.auth.RefreshTokenService;
import com.draazy.api.identity.auth.StaffInviteService;
import com.draazy.api.identity.auth.StaffSignInService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserMapper;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserResponse;
import com.draazy.api.identity.user.UserStatuses;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.BackOfficeFunctions;
import com.draazy.api.security.Roles;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

// List masks mobiles; single-user read reveals and audits.
@Service
public class UserAdminService {

    private final UserRepository users;
    private final UserMapper mapper;
    private final AuditService audit;
    private final AdministratorGuard administrators;
    private final StaffInviteService invites;
    private final StaffSignInService staffSignIn;
    private final RefreshTokenService refreshTokens;
    private final AdminActionNotifier adminNotifications;
    private final BackOfficeGrantRepository grants;
    private final AccountPermissions accountPermissions;
    private final ObjectMapper objectMapper;
    private final String baseUrl;

    /** Lookup and the masked/full wire projection, shared with {@link UserModerationService}. */
    private final BackOfficeUserView view;

    public UserAdminService(UserRepository users, UserMapper mapper,
            AuditService audit, AdministratorGuard administrators,
            StaffInviteService invites,
            StaffSignInService staffSignIn, RefreshTokenService refreshTokens,
            BackOfficeUserView view, AdminActionNotifier adminNotifications,
            BackOfficeGrantRepository grants, AccountPermissions accountPermissions,
            ObjectMapper objectMapper,
            @Value("${draazy.app.base-url}") String baseUrl) {
        this.users = users;
        this.mapper = mapper;
        this.audit = audit;
        this.administrators = administrators;
        this.invites = invites;
        this.staffSignIn = staffSignIn;
        this.refreshTokens = refreshTokens;
        this.view = view;
        this.adminNotifications = adminNotifications;
        this.grants = grants;
        this.accountPermissions = accountPermissions;
        this.objectMapper = objectMapper;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
    }

    // No audit row: list pages reveal no unmasked mobile and would bury real reveal reads.
    @Transactional(readOnly = true)
    public Page<UserResponse> list(String role, boolean customers, String q, String status, Boolean flagged,
            boolean archived, Pageable pageable) {
        String prefix = (q == null || q.isBlank()) ? null : likePrefix(q.trim().toLowerCase());
        String state = (status == null || status.isBlank()) ? null : status.trim();
        return users.searchForAdmin(role, customers, prefix, state, flagged, archived, pageable)
                .map(this::masked);
    }

    // One grouped COUNT over the same role/customers/q the list uses, so every status tab says what it
    // would show. Archived is its own column: an archived row counts only under "archived".
    @Transactional(readOnly = true)
    public Map<String, Long> statusCounts(String role, boolean customers, String q) {
        String prefix = (q == null || q.isBlank()) ? null : likePrefix(q.trim().toLowerCase());
        long all = 0;
        long active = 0;
        long suspended = 0;
        long archived = 0;
        for (Object[] row : users.countByStanding(role, customers, prefix)) {
            long n = (Long) row[2];
            if ((Boolean) row[0]) {
                archived += n;
                continue;
            }
            all += n;
            if (UserStatuses.ACTIVE.equals(row[1])) {
                active += n;
            } else if (UserStatuses.SUSPENDED.equals(row[1])) {
                suspended += n;
            }
        }
        return Map.of("all", all, "active", active, "suspended", suspended, "archived", archived);
    }

    // Turn a search term into an anchored LIKE pattern, neutralising the caller's own wildcards —
    // ?q=% would otherwise be an unanchored scan of every user. Escape char matches the query.
    private static String likePrefix(String term) {
        return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    // Audit before building the response so a mobile reveal cannot succeed unlogged.
    @Transactional
    public UserResponse get(AuthPrincipal actor, String id) {
        User user = load(id);
        audit.record(actor, "user.contact.reveal", "user", id, "mobile", MobileMask.mask(user.getMobile()));
        return view.full(user);
    }

    // Catch email collisions here so operators see a named field, not a generic conflict.
    @Transactional
    public UserResponse update(AuthPrincipal actor, String id, String name, String email, String avatar) {
        User user = load(id);
        refuseManagerOnNonStaff(actor, user);
        String previousName = user.getName();
        boolean nameChanged = false;
        if (name != null && !name.isBlank()) {
            String nextName = name.trim();
            nameChanged = !nextName.equals(previousName);
            if (nameChanged && user.isVerified()) {
                throw new ConflictException(ErrorCodes.NAME_LOCKED_WHILE_VERIFIED,
                        "Verified profiles cannot change name from admin edit. Use the trust review flow.");
            }
            user.setName(nextName);
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
        if (nameChanged) {
            audit.record(actor, "user.update", "user", id, "name", name,
                    "previousName", previousName, "email", email, "avatar", avatar);
        } else {
            audit.record(actor, "user.update", "user", id, "name", name, "email", email,
                    "avatar", avatar);
        }
        return view.full(user);
    }

    // Refuse self or last admin before archiving any back-office account.
    @Transactional
    public void archive(AuthPrincipal actor, String id, String reason) {
        User user = load(id);
        refuseManagerOnNonStaff(actor, user);
        if (actor.userId().equals(user.getId())) {
            throw new ForbiddenException("You cannot archive your own account");
        }
        administrators.refuseIfLastAdministrator(user);
        user.archive(reason);
        audit.record(actor, "user.archive", "user", id, "reason", reason, "role", user.getRole());
        adminNotifications.managerAction(actor, "Archived staff account", user);
    }

    @Transactional
    public void restore(AuthPrincipal actor, String id) {
        User user = load(id);
        refuseManagerOnNonStaff(actor, user);
        refuseIfEmailIsHeldByALiveAccount(user);
        user.restore();
        audit.record(actor, "user.restore", "user", id, "role", user.getRole());
        adminNotifications.managerAction(actor, "Restored staff account", user);
    }

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

    // Privilege escalation: no password is set; the holder activates via invite.
    @Transactional
    public StaffCreateResponse addStaff(AuthPrincipal actor, String name, String mobile, String email,
            String role, List<String> functions) {

        // @IndianMobile validated the shape; canonicalise so the dedup check and the stored row key
        // off the same ten digits the column CHECK enforces.
        mobile = MobileMask.normalise(mobile);
        if (Roles.Wire.ADMIN.equals(role)) {
            throw new ForbiddenException(
                    "There is one administrator per environment. Create a staff account instead.");
        }
        if (Roles.Wire.MANAGER.equals(actor.role()) && !Roles.Wire.STAFF.equals(role)) {
            throw new ForbiddenException("Managers can only create staff accounts");
        }
        if (!Roles.Wire.STAFF.equals(role) && !Roles.Wire.MANAGER.equals(role)) {
            throw new ForbiddenException("Back-office accounts may only be created with role manager or staff");
        }
        Set<String> functionNames = functionsForCreate(actor, role, functions);
        if (users.existsByMobile(mobile)) {
            throw new ConflictException("A user with that mobile already exists");
        }
        if (users.existsByEmailIgnoreCaseAndArchivedFalse(email)) {
            throw new ConflictException("A user with that email already exists");
        }
        User user = new User(mobile, role);
        user.setName(name.trim());
        user.setEmail(email.trim());

        User saved = users.saveAndFlush(user);
        if (Roles.Wire.STAFF.equals(role)) {
            grants.save(new BackOfficeGrant(saved.getId(), objectMapper.writeValueAsString(functionNames),
                    actor.userId()));
        }
        String inviteUrl = inviteUrl(invites.issue(saved.getId(), actor.userId()));
        audit.record(actor, "user.staff.create", "user", saved.getId().toString(),
                "email", email, "role", role, "functions", objectMapper.writeValueAsString(functionNames));
        adminNotifications.managerAction(actor, "Created staff account", saved);
        return new StaffCreateResponse(mapper.toResponse(saved), inviteUrl);
    }

    private Set<String> functionsForCreate(AuthPrincipal actor, String role, List<String> requested) {
        if (Roles.Wire.MANAGER.equals(role)) {
            return Set.of();
        }
        Set<String> names = new LinkedHashSet<>();
        if (requested != null) {
            names.addAll(requested);
        }
        Set<String> ceiling = BackOfficeFunctions.assignableForRole(role);
        Set<String> actorCeiling = Roles.Wire.MANAGER.equals(actor.role())
                ? accountPermissions.functionsFor(actor.role(), actor.userId())
                : null;
        for (String function : names) {
            if (!BackOfficeFunctions.isKnown(function)) {
                throw new ValidationException("Not a back-office function this server enforces: " + function);
            }
            if (!ceiling.contains(function)) {
                throw new ValidationException("A " + role + " account can never hold " + function);
            }
            if (actorCeiling != null && !actorCeiling.contains(function)) {
                throw new ForbiddenException("Managers can only grant functions they hold");
            }
        }
        return names;
    }

    /** Mask the mobile on the wire without touching the managed entity. */
    private UserResponse masked(User user) {
        return view.masked(user);
    }

    // Lost phone: clear the authenticator and end live sessions; next sign-in enrols afresh.
    @Transactional
    public void resetSecondFactor(AuthPrincipal actor, String id) {
        User target = loadBackOfficeColleague(actor, id, "reset your own authenticator");
        staffSignIn.resetSecondFactor(target.getId());
        refreshTokens.revokeAllForUser(target.getId());
        audit.record(actor, "user.staff.2fa.reset", "user", id, "role", target.getRole());
        adminNotifications.managerAction(actor, "Reset 2FA", target);
    }

    // Forgotten password: the fresh open invite blocks sign-in until the holder sets a new one.
    @Transactional
    public StaffInviteResponse reissueInvite(AuthPrincipal actor, String id) {
        User target = loadBackOfficeColleague(actor, id, "reissue your own invite");
        String inviteUrl = inviteUrl(invites.reissue(target.getId(), actor.userId()));
        refreshTokens.revokeAllForUser(target.getId());
        audit.record(actor, "user.staff.invite.reissue", "user", id, "role", target.getRole());
        adminNotifications.managerAction(actor, "Reissued invite", target);
        return new StaffInviteResponse(inviteUrl);
    }

    private String inviteUrl(String token) {
        return baseUrl + "/staff-invite#" + token;
    }

    private User loadBackOfficeColleague(AuthPrincipal actor, String id, String selfAction) {
        User target = load(id);
        if (actor.userId().equals(target.getId())) {
            throw new ForbiddenException("You cannot " + selfAction + ". Ask another administrator.");
        }
        if (!Roles.isBackOffice(target.getRole())) {
            throw new ConflictException("Only back-office accounts sign in with a password.");
        }
        refuseManagerOnNonStaff(actor, target);
        // A fresh invite or authenticator lets the holder sign in as the target, so a manager may
        // only do it for staff whose functions it holds itself.
        if (Roles.Wire.MANAGER.equals(actor.role())
                && !accountPermissions.functionsFor(actor.role(), actor.userId())
                        .containsAll(accountPermissions.functionsFor(target.getRole(), target.getId()))) {
            throw new ForbiddenException(
                    "This staff member holds functions you don't. Ask the administrator.");
        }
        return target;
    }

    private static void refuseManagerOnNonStaff(AuthPrincipal actor, User target) {
        if (Roles.Wire.MANAGER.equals(actor.role()) && !Roles.Wire.STAFF.equals(target.getRole())) {
            throw new ForbiddenException("Managers can only manage staff accounts");
        }
    }

    private User load(String id) {
        return view.load(id);
    }
}
