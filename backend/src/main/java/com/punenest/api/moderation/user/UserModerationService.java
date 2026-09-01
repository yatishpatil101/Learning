package com.punenest.api.moderation.user;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.ValidationException;
import com.punenest.api.common.trust.OwnerBadgeSink;
import com.punenest.api.identity.auth.RefreshTokenService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserResponse;
import com.punenest.api.identity.user.UserStatuses;
import com.punenest.api.security.AuthPrincipal;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Moderation actions against a person's account (V77): suspension, the identity badge, and the
 * internal review flag.
 *
 * <p><strong>Separate from {@link UserAdminService} because it is a different use case, not a
 * smaller one.</strong> That service administers the directory — find somebody, correct their name,
 * mint a colleague, retire an account. This one takes a decision <em>about</em> somebody, and each
 * of the three has a consequence outside the {@code users} row: a suspension ends live sessions and
 * is enforced in {@code AuthService}, a badge propagates to every listing the person owns, a flag is
 * a note the account holder must never see. Splitting on that line is what
 * {@code package-structure.md} §4.1 means by "by use case": each file can be read on its own and
 * answers one question.
 *
 * <p><strong>What all three have in common is that the console had them first.</strong> The user
 * directory has offered these buttons since it was written, backed by nothing but the browser's own
 * copy of the database. They worked perfectly for one operator at one machine until they reloaded.
 * Converting the page onto the live API forced the choice between recording the capability as lost
 * and building it; this is the second.
 */
@Service
public class UserModerationService {

    /**
     * How many events {@link #timeline} returns.
     *
     * <p>Fifty because the modal is a glance taken while deciding what to do about somebody, and
     * fifty entries is already more than fits on a screen. See {@code UserTimelineRepository} for
     * why this is a cap and not a page size.
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

    public UserModerationService(BackOfficeUserView view, AuditService audit,
            AdministratorGuard administrators, RefreshTokenService sessions,
            OwnerBadgeSink ownerBadges, UserTimelineRepository timelines) {
        this.view = view;
        this.audit = audit;
        this.administrators = administrators;
        this.sessions = sessions;
        this.ownerBadges = ownerBadges;
        this.timelines = timelines;
    }

    /**
     * {@code PATCH /users/{id}/suspend} — take away the ability to sign in, and nothing else.
     *
     * <p><strong>Why this is not {@code archive}.</strong> Archiving is the soft delete: the account
     * leaves the directory, and every read path on the platform already filters it out. That is the
     * right answer for someone who has gone, and precisely the wrong one for someone under
     * investigation, because it hides the account from the colleagues who need to look at it. The
     * {@code suspended} value has been in the {@code users_status_check} constraint since V2 and no
     * route has ever written it.
     *
     * <p><strong>The suspension is only real because {@code AuthService} enforces it.</strong>
     * Writing the column alone would have produced a button that changes a badge — the person would
     * keep signing in, and the moderator would believe they had stopped them. That is worse than not
     * having the feature. The refusal lives in {@code refuseIfCannotYetAuthenticate}, which is on
     * every path that mints a session, including refresh.
     *
     * <p><strong>And existing sessions are killed.</strong> Refusing at issue-time still leaves the
     * suspended person holding a valid access token until it expires. Revoking the refresh family
     * closes the window to the access-token TTL, which is the best a stateless token design can do
     * without a per-request lookup. Skipping it would mean a suspension that takes effect at some
     * unpredictable point in the next hour.
     *
     * <p>Guarded the way archiving is: not yourself (a suspended administrator cannot un-suspend
     * themselves, and on a single-admin platform nobody else could either), and not the last
     * administrator.
     *
     * <p>Idempotent by design — suspending a suspended account is a no-op. A moderator who clicks
     * twice, or two moderators who reach the same conclusion, should not get a conflict; the state
     * they wanted is the state that holds.
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
     * {@code PATCH /users/{id}/reactivate} — return a suspended account to {@code active}.
     *
     * <p>Deliberately narrow: it refuses an account whose status is {@code archived}, because that
     * state belongs to {@code UserAdminService#restore}, which has a guard this route does not (the
     * live-email collision). Silently promoting an archived row to {@code active} here would leave
     * {@code archived = true} and {@code status = active} — a row that is invisible to the directory
     * and claims to be fine.
     *
     * <p>Idempotent for an already-active account, for the same reason {@link #suspend} is.
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
     * {@code PATCH /users/{id}/badge} — grant or withdraw the L2 "Verified" badge by hand.
     *
     * <p><strong>Why this exists at all, given DigiLocker.</strong> The automated funnel is the
     * normal path and stays the only writer of {@code aadhaar_verified}. It cannot reach everybody:
     * an owner whose Aadhaar is not linked to the number they signed up with, a company account, a
     * person an administrator has met and whose documents they have seen. Without a manual path
     * those people are permanently unverifiable, which pushes the whole judgement off-platform.
     *
     * <p><strong>A hand-granted badge is distinguishable from an earned one, and no new column was
     * added to say so.</strong> {@code aadhaar_verified} already carries that information: this
     * route never sets it, so {@code verified && !aadhaarVerified} <em>is</em> "an administrator
     * vouched for this person". Anything that needs to weigh the two differently can, and nothing
     * has to trust a flag that could drift out of step with the fact it describes.
     *
     * <p><strong>Withdrawing an Aadhaar-derived badge is refused.</strong> Not out of deference to
     * the funnel, but because the result would be unrecoverable through any screen: the webhook
     * handler returns early on an already-verified row, so a replay would not restore what this
     * route removed, and there is no second path that sets the column. The operator would be left
     * with a person who passed DigiLocker and shows as unverified for good. If the verification
     * itself is in doubt, that is an action against the verification record, not a toggle here.
     *
     * <p>The listing propagation runs in both directions for the same reason the funnel does it on
     * grant: without it the owner sees one answer on their profile while every listing they hold
     * tells buyers the other, and the badge is sold on being the same claim in both places.
     */
    @Transactional
    public UserResponse setBadge(AuthPrincipal actor, String id, boolean granted, String reason) {
        User user = view.load(id);
        if (!granted && user.isAadhaarVerified()) {
            throw new ConflictException(
                    "This badge was earned through Aadhaar verification and cannot be withdrawn "
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
     * {@code PATCH /users/{id}/flag} — raise or lower the internal review marker.
     *
     * <p>Changes nothing the platform does; see {@code User#flagged}. A reason is required to raise
     * one and validated here rather than only by V77's CHECK, so the operator gets a sentence rather
     * than a constraint violation.
     *
     * <p>No self-check and no last-administrator guard, unlike suspension: a flag takes nothing
     * away, so there is nothing to lock yourself out of. An administrator flagging their own account
     * is odd but harmless, and refusing it would be a rule with no injury behind it.
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
     * {@code GET /users/{id}/timeline} — what this person has done, newest first.
     *
     * <p>Loads the user first purely so an unknown id answers 404 rather than an empty list. The
     * distinction matters here more than usual: an empty timeline is a real and common answer for a
     * freshly-registered account, so without the lookup a mistyped id would render as "this person
     * has done nothing", which is the sort of confident wrong answer this whole conversion exists
     * to remove.
     */
    @Transactional(readOnly = true)
    public List<UserTimelineEntry> timeline(String id) {
        User user = view.load(id);
        return timelines.timeline(user.getId(), TIMELINE_CAP);
    }
}
