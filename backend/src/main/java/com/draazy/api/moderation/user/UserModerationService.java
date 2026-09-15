package com.draazy.api.moderation.user;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.trust.OwnerBadgeSink;
import com.draazy.api.identity.auth.RefreshTokenService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserResponse;
import com.draazy.api.identity.user.UserStatuses;
import com.draazy.api.identity.verification.IdentityVerificationService;
import com.draazy.api.security.AuthPrincipal;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Moderation actions against a person's account: suspension, the identity badge, and the internal
 * review flag. Separate from {@code UserAdminService}: each has a consequence outside the row.
 */
@Service
public class UserModerationService {

    /**
     * How many events {@link #timeline} returns — a cap, not a page size: the modal is a glance
     * taken while deciding what to do about somebody.
     */
    private static final int TIMELINE_CAP = 50;

    private final BackOfficeUserView view;
    private final AuditService audit;
    private final AdministratorGuard administrators;
    /** Session kill on suspension — see {@link #suspend} for why writing the column is not enough. */
    private final RefreshTokenService sessions;
    /** Keeps a hand-granted badge and the listings that advertise it true together. */
    private final OwnerBadgeSink ownerBadges;
    /** The activity read behind {@link #timeline}. */
    private final UserTimelineRepository timelines;
    private final IdentityVerificationService identity;

    public UserModerationService(BackOfficeUserView view, AuditService audit,
            AdministratorGuard administrators, RefreshTokenService sessions,
            OwnerBadgeSink ownerBadges, UserTimelineRepository timelines,
            IdentityVerificationService identity) {
        this.view = view;
        this.audit = audit;
        this.administrators = administrators;
        this.sessions = sessions;
        this.ownerBadges = ownerBadges;
        this.timelines = timelines;
        this.identity = identity;
    }

    /**
     * {@code PATCH /users/{id}/suspend} — take away the ability to sign in, and nothing else.
     * Rationale: docs/flows/admin/users-kyc.md#account-moderation.
     */
    @Transactional
    public void suspend(AuthPrincipal actor, String id, String reason) {
        User user = view.load(id);
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
    }

    /**
     * {@code PATCH /users/{id}/reactivate} — return a suspended account to {@code active}. Refuses
     * an archived one: that belongs to {@code UserAdminService#restore}, which holds the email guard.
     */
    @Transactional
    public void reactivate(AuthPrincipal actor, String id) {
        User user = view.load(id);
        if (UserStatuses.ARCHIVED.equals(user.getStatus())) {
            throw new ConflictException(
                    "This account is archived, not suspended. Restore it first.");
        }
        if (UserStatuses.ACTIVE.equals(user.getStatus())) {
            return;
        }
        user.setStatus(UserStatuses.ACTIVE);
        audit.record(actor, "user.reactivate", "user", id, "role", user.getRole());
    }

    /**
     * {@code PATCH /users/{id}/badge} — grant or withdraw the L2 "Verified" badge by hand, for the
     * people the document flow cannot reach. Rationale: docs/flows/admin/users-kyc.md#account-moderation.
     */
    @Transactional
    public UserResponse setBadge(AuthPrincipal actor, String id, boolean granted, String reason) {
        User user = view.load(id);
        if (!granted && identity.isVerified(user.getId())) {
            throw new ConflictException(
                    "This badge was earned through identity verification and cannot be withdrawn "
                            + "here. Nothing would restore it: act on the verification record "
                            + "instead.");
        }
        if (user.isVerified() != granted) {
            user.setVerified(granted);
            if (granted) {
                ownerBadges.markOwnerVerified(user.getId());
            } else {
                ownerBadges.markOwnerUnverified(user.getId());
            }
        }
        audit.record(actor, "user.badge", "user", id,
                "granted", String.valueOf(granted), "reason", reason, "role", user.getRole());
        return view.full(user);
    }

    /**
     * {@code PATCH /users/{id}/flag} — raise or lower the internal review marker. No self-check or
     * last-administrator guard: a flag takes nothing away, so there is nothing to lock out of.
     */
    @Transactional
    public UserResponse setFlag(AuthPrincipal actor, String id, boolean flagged, String reason) {
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
        return view.full(user);
    }

    /**
     * {@code GET /users/{id}/timeline} — what this person has done, newest first. Loads the user
     * first so an unknown id answers 404 rather than rendering as "this person has done nothing".
     */
    @Transactional(readOnly = true)
    public List<UserTimelineEntry> timeline(String id) {
        User user = view.load(id);
        return timelines.timeline(user.getId(), TIMELINE_CAP);
    }
}
