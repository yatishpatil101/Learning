package com.draazy.api.moderation.user;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.identity.auth.RefreshTokenService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserStatuses;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserModerationService {

    // A cap, not a page size: the modal is a quick review while deciding what to do.
    private static final int TIMELINE_CAP = 50;

    private final BackOfficeUserView view;
    private final AuditService audit;
    private final AdministratorGuard administrators;

    /** Session kill on suspension — see {@link #suspend} for why writing the column is not enough. */
    private final RefreshTokenService sessions;

    private final UserTimelineRepository timelines;
    private final BadgeGrantService badgeGrants;
    private final AdminActionNotifier adminNotifications;

    public UserModerationService(BackOfficeUserView view, AuditService audit,
            AdministratorGuard administrators, RefreshTokenService sessions,
            UserTimelineRepository timelines, BadgeGrantService badgeGrants,
            AdminActionNotifier adminNotifications) {
        this.view = view;
        this.audit = audit;
        this.administrators = administrators;
        this.sessions = sessions;
        this.timelines = timelines;
        this.badgeGrants = badgeGrants;
        this.adminNotifications = adminNotifications;
    }

    // Suspension takes away sign-in and nothing else.
    @Transactional
    public void suspend(AuthPrincipal actor, String id, String reason) {
        User user = view.load(id);
        refuseManagerOnNonStaff(actor, user);
        if (actor.userId().equals(user.getId())) {
            throw new ForbiddenException("You cannot suspend your own account");
        }
        administrators.refuseIfLastAdministrator(user);
        if (UserStatuses.SUSPENDED.equals(user.getStatus())) {
            return;
        }
        user.setStatus(UserStatuses.SUSPENDED);
        sessions.revokeAllForUser(user.getId());
        audit.record(actor, "user.suspend", "user", id, "reason", reason, "role", user.getRole());
        adminNotifications.managerAction(actor, "Suspended staff account", user);
    }

    // Archived accounts must go through restore, which holds the email guard.
    @Transactional
    public void reactivate(AuthPrincipal actor, String id) {
        User user = view.load(id);
        refuseManagerOnNonStaff(actor, user);
        if (UserStatuses.ARCHIVED.equals(user.getStatus())) {
            throw new ConflictException(
                    "This account is archived, not suspended. Restore it first.");
        }
        if (UserStatuses.ACTIVE.equals(user.getStatus())) {
            return;
        }
        user.setStatus(UserStatuses.ACTIVE);
        audit.record(actor, "user.reactivate", "user", id, "role", user.getRole());
        adminNotifications.managerAction(actor, "Reactivated staff account", user);
    }

    // Manual badge path exists for people the document flow cannot reach.
    @Transactional
    public Object setBadge(AuthPrincipal actor, String id, boolean granted, String reason) {
        return granted
                ? badgeGrants.request(actor, id, reason)
                : badgeGrants.withdraw(actor, id, reason);
    }

    // No self or last-admin guard: a flag takes nothing away.
    @Transactional
    public AdminUserRow setFlag(AuthPrincipal actor, String id, boolean flagged, String reason) {
        User user = view.load(id);
        if (flagged) {
            if (reason == null || reason.isBlank()) {
                throw new ValidationException(
                        "Say what you noticed. A flag without a reason is one the next moderator "
                                + "cannot act on.");
            }
            user.flag(reason.trim(), actor.userId());
        } else {
            user.clearFlag();
        }
        audit.record(actor, flagged ? "user.flag" : "user.flag.clear", "user", id,
                "reason", reason, "role", user.getRole());
        return view.row(user);
    }

    // Load user first so an unknown id returns 404, not an empty timeline.
    @Transactional(readOnly = true)
    public List<UserTimelineEntry> timeline(String id) {
        User user = view.load(id);
        return timelines.timeline(user.getId(), TIMELINE_CAP);
    }

    private static void refuseManagerOnNonStaff(AuthPrincipal actor, User target) {
        if (Roles.Wire.MANAGER.equals(actor.role()) && !Roles.Wire.STAFF.equals(target.getRole())) {
            throw new ForbiddenException("Managers can only manage staff accounts");
        }
    }
}
