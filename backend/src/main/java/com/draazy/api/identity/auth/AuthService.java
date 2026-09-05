package com.draazy.api.identity.auth;

import com.draazy.api.common.access.StaffAccountApprovalRepository;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.security.JwtService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.SelfProfile;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserService;
import com.draazy.api.identity.user.UserStatuses;
import com.draazy.api.provider.OtpSender;
import java.time.Instant;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Orchestrates the four authentication flows by composing the cross-cutting foundation — it owns none
 * of the crypto itself: OTP ({@link OtpService}), access tokens ({@link JwtService}), refresh rotation
 * ({@link RefreshTokenService}), and BCrypt ({@link PasswordEncoder}) each stay single-responsibility.
 *
 * <p>Security posture baked in here: consumer login is passwordless and auto-provisioning (the first
 * OTP-verified sign-in creates a {@code buyer} at the L1 floor, ADR-019); staff use email+password;
 * failures are deliberately vague ({@code Unauthorized}) so the endpoints don't leak whether a mobile
 * or email exists.
 */
@Service
public class AuthService {

    // BCrypt hash for a dummy secret used only to equalize unknown-email work in staff login.
    private static final String STAFF_LOGIN_DUMMY_BCRYPT =
            "$2a$10$7EqJtq98hPqEX7fNZaFWoOeR6Y4u5M4YB9Gf4bm/FvGV8eK3oprm.";

    private final UserRepository users;
    private final UserService userService;
    private final SelfProfile selfProfile;
    private final OtpService otpService;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokens;
    private final PasswordEncoder passwordEncoder;
    private final StaffAccountApprovalRepository approvals;
    private final StaffInviteRepository invites;

    public AuthService(UserRepository users, UserService userService, SelfProfile selfProfile,
            OtpService otpService, JwtService jwtService, RefreshTokenService refreshTokens,
            PasswordEncoder passwordEncoder, StaffAccountApprovalRepository approvals,
            StaffInviteRepository invites) {
        this.users = users;
        this.userService = userService;
        this.selfProfile = selfProfile;
        this.otpService = otpService;
        this.jwtService = jwtService;
        this.refreshTokens = refreshTokens;
        this.passwordEncoder = passwordEncoder;
        this.approvals = approvals;
        this.invites = invites;
    }

    /**
     * Dual-mode mobile-OTP login (contract {@code POST /auth/login}). No OTP present ⇒ send a code and
     * acknowledge; OTP present ⇒ verify it, find-or-create the account, and issue tokens.
     *
     * <p>{@code noRollbackFor} the two OTP-verification errors: their handlers mutate the OTP row
     * (recording a failed attempt / burning a capped code) and that bookkeeping <em>must</em> survive
     * the thrown 401/429 — otherwise the per-code attempt cap silently resets every request and the
     * brute-force ceiling is lost. {@link ForbiddenException} is on the list for the same reason and
     * a subtler one: it is what {@link #refuseIfCannotYetAuthenticate} throws, and that happens
     * <em>after</em> {@code verifyLoginCode} has burnt the code. Rolling back there would hand the
     * OTP's single-use property away on exactly the accounts under the most scrutiny — the holder
     * could replay one delivered code for its whole TTL. All other failures roll back as usual.
     *
     * <p>{@link OtpSender.DeliveryFailedException} is on the list for a
     * different kind of bookkeeping, explained in full on {@code OtpService.sendCode}: the send
     * budget is derived from the {@code otp_codes} rows, so rolling one back on a delivery failure
     * would refund the attempt and leave the only limit on "ring this number" refundable on demand.
     * This transaction is the one that owns that row on the login path, so the rule has to be
     * repeated here — the advice inside {@code OtpService} merely participates in it.
     */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class,
            ForbiddenException.class, OtpSender.DeliveryFailedException.class})
    public AuthResponse login(LoginRequest request) {
        // @IndianMobile validated the shape; canonicalise once so OTP send, OTP verify and the account
        // lookup all key off the same ten digits regardless of how the caller spaced or prefixed them.
        String mobile = MobileMask.normalise(request.mobile());
        if (!request.hasOtp()) {
            otpService.sendLoginCode(mobile);
            return AuthResponse.otpAck();
        }
        otpService.verifyLoginCode(mobile, request.otp());
        User user = findOrProvision(mobile);
        return issueFor(user);
    }

    /** Internal staff/admin email+password login (contract {@code POST /auth/staff-login}). */
    @Transactional
    public AuthResponse staffLogin(StaffLoginRequest request) {
        User user = users.findByEmailIgnoreCaseAndArchivedFalse(request.email()).orElse(null);

        // Keep the unknown-email path on equivalent bcrypt work so staff-email enumeration is harder.
        String hash = user != null && user.getPasswordHash() != null
            ? user.getPasswordHash()
            : STAFF_LOGIN_DUMMY_BCRYPT;
        boolean passwordMatches = passwordEncoder.matches(request.password(), hash);

        // why: never reveal which half failed; a null hash (passwordless account) must also 401.
        if (user == null || user.getPasswordHash() == null || !passwordMatches) {
            throw new UnauthorizedException("Invalid credentials");
        }
        return issueFor(user);
    }

    /**
     * Rotate a refresh token and mint a new access token (contract {@code POST /auth/refresh}).
     *
     * <p>Takes the raw token rather than a request body: it arrives in an {@code HttpOnly} cookie,
     * and where a credential travelled is the controller's business, not this method's.
     *
     * <p>{@code noRollbackFor} the 401 so the two revocations on this path survive it: the
     * reuse-detection family burn inside {@link RefreshTokenService#rotate} and the
     * {@code revokeAllForUser} below for a user who has since been archived. Both are security
     * actions taken <em>because</em> the request is being refused, so rolling them back with the
     * refusal undoes the only useful thing that happened. {@link #login} has carried the same rule
     * for the same reason since D90; {@code refresh} did not, and its tripwire was inert until
     * 2026-08-11.
     *
     * <p>Deliberately <em>not</em> {@link ForbiddenException} — see the D200 note below, where
     * rolling the rotation back is the wanted behaviour.
     */
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public AuthResponse refresh(String presentedToken) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(presentedToken);
        User user = users.findByIdAndArchivedFalse(rotation.userId()).orElse(null);
        if (user == null) {
            refreshTokens.revokeAllForUser(rotation.userId());
            throw new UnauthorizedException("Invalid refresh token");
        }
        // D200's gate again, and NOT because a held account can reach here today — it cannot, since
        // the only writer of an approval row is `addStaff`, which writes it in the same transaction
        // that inserts the user, so no token can predate the hold. That argument is true by accident
        // of the current write paths and nothing enforces it. The moment anyone holds an account
        // that already exists — which is the obvious incident-response use of this table, and what
        // its own COMMENT invites — every live session would keep refreshing for the whole refresh
        // TTL, and the one place saying otherwise would be a comment. A primary-key lookup is a
        // cheap price for making "cannot authenticate" mean it on all three issuing paths.
        //
        // The refused caller's rotation rolls back with the transaction, so their old refresh token
        // survives; that is harmless, because every attempt to spend it lands here again.
        refuseIfCannotYetAuthenticate(user);
        String access = jwtService.issueAccessToken(user);
        return AuthResponse.tokens(access, rotation.refreshToken(),
                jwtService.accessTtl().toSeconds(), selfProfile.of(user));
    }

    /** Best-effort session kill (contract {@code POST /auth/logout}): revoke the user's refresh family. */
    @Transactional
    public void logout(UUID userId) {
        refreshTokens.revokeAllForUser(userId);
    }

    /**
     * Return the live account for a just-verified mobile, creating a passwordless {@code buyer} on
     * first sign-in. An archived mobile is refused rather than silently resurrected.
     */
    private User findOrProvision(String mobile) {
        User user = users.findByMobile(mobile).map(existing -> {
            if (existing.isArchived()) {
                throw new UnauthorizedException("Account is archived");
            }
            existing.setMobileVerified(true);
            return existing;
        }).orElseGet(() -> {
            try {
                return userService.provisionBuyer(mobile);
            } catch (DataIntegrityViolationException race) {
                // A concurrent first sign-in inserted this mobile first — adopt the winner's row rather
                // than surfacing a 500. Its REQUIRES_NEW tx rolled back in isolation, so ours is clean.
                return users.findByMobileAndArchivedFalse(mobile)
                        .orElseThrow(() -> new UnauthorizedException("Account is archived"));
            }
        });
        return user;
    }

    /** Mint an access+refresh pair for an authenticated user and stamp last-active. */
    private AuthResponse issueFor(User user) {
        refuseIfCannotYetAuthenticate(user);
        user.setLastActive(Instant.now());
        String access = jwtService.issueAccessToken(user);
        String refresh = refreshTokens.issue(user.getId());
        // SelfProfile, not the bare mapper: every one of these responses is the caller reading
        // themselves, and the client caches the embedded user as its session identity. A sign-in
        // that omitted the back-office atoms would leave the console with an empty sidebar until
        // something happened to call GET /auth/me again.
        return AuthResponse.tokens(access, refresh,
                jwtService.accessTtl().toSeconds(), selfProfile.of(user));
    }

    /**
     * The conditions that stop an account obtaining a session at all.
     *
     * <p><strong>Suspension</strong> (V77): a moderator has stopped this account — see
     * {@link #refuseIfSuspended}. Unlike the two below it applies to every account on the platform,
     * not only back-office ones, and unlike them it is a decision rather than a step not yet taken.
     * <strong>Maker-checker</strong> (tech debt D200, V67): an account minted through
     * {@code POST /users/staff} may not obtain a token until a second administrator approves it.
     * <strong>Activation</strong> (tech debt D206, V71): nor until the person it belongs to has
     * redeemed their invite and chosen a password — see {@link #refuseIfInviteIsStillOpen}. The
     * three are independent, and an account clears them in whichever order its people get round to.
     *
     * <p><strong>Called from {@link #issueFor} and from {@link #refresh}</strong>, which between
     * them cover every path that produces a session. {@code issueFor} is the funnel the password and
     * mobile-OTP flows already share, and the OTP one is the path that matters: the account an
     * attacker just minted has a mobile number and no password, so {@code POST /auth/login} is what
     * they would actually use. {@code refresh} mints an access token without going through
     * {@code issueFor}, so it needs the call of its own — see the note there for why relying on
     * "a refresh token can only exist if issueFor minted one" is a claim about today's write paths
     * rather than an enforced invariant.
     *
     * <p><strong>403, and only after the credential has been checked.</strong> The ordering is
     * load-bearing: {@link #staffLogin} verifies the password before calling this, and {@link #login}
     * verifies the OTP, so a caller who reaches this message has already proved they hold the
     * credential and learns nothing they did not know. Answering 401 here instead would be honest
     * about the outcome and useless to the blocked colleague, who would spend the morning retyping a
     * password that is correct.
     *
     * <p>An account with no row is not subject to maker-checker — every account created before V67,
     * and every consumer account. See {@code StaffAccountApprovalRepository}: the query is phrased as
     * "is there an unapproved row" precisely so that absence answers {@code false}.
     */
    private void refuseIfCannotYetAuthenticate(User user) {
        refuseIfSuspended(user);
        if (approvals.existsByUserIdAndApprovedAtIsNull(user.getId())) {
            throw new ForbiddenException(
                    "This account is waiting to be approved by a second administrator. "
                            + "Ask an administrator other than the one who created it to approve "
                            + "it, then sign in again.");
        }
        refuseIfInviteIsStillOpen(user);
    }

    /**
     * V77: an account a moderator has suspended may not obtain a session.
     *
     * <p><strong>This is what makes {@code PATCH /users/{id}/suspend} a moderation action rather
     * than a badge.</strong> The {@code suspended} value has been in {@code users_status_check}
     * since V2 and, until V77, nothing wrote it and nothing read it. Shipping the write without this
     * read would have been the worse of the two halves: the console would show the account as
     * stopped, the moderator would move on, and the person would carry on signing in.
     *
     * <p><strong>Why it is checked first of the three.</strong> The other two refusals name a thing
     * the account holder can fix or chase — get your colleague approved, redeem your invite. This
     * one is a decision that has been taken about them, and telling somebody to chase an approval
     * when they have in fact been suspended sends them to bother an administrator who already knows.
     *
     * <p><strong>Why it is deliberately unspecific.</strong> The message names no reason and no
     * moderator. The reason is in {@code audit_log} for the back office, and repeating it here would
     * hand a suspended account exactly the information most useful for arguing with, or evading, the
     * decision. \"Contact support\" is the honest next step, because a suspension is meant to be
     * lifted by a person, not by a retry.
     *
     * <p>Note that suspension does not stand in for archival: {@link #findOrProvision} refuses an
     * archived account separately and earlier, before a session is ever attempted. The two columns
     * are independent (see {@code UserStatuses}) and so are their refusals.
     */
    private void refuseIfSuspended(User user) {
        if (UserStatuses.SUSPENDED.equals(user.getStatus())) {
            throw new ForbiddenException(
                    "This account has been suspended. Contact support if you think that is a "
                            + "mistake.");
        }
    }

    /**
     * D206: an account whose holder has not yet set their own password may not obtain a token.
     *
     * <p><strong>This is a second, independent gate and not a restatement of the first.</strong>
     * Since D206 neither administrator supplies a password, so a freshly minted account has no
     * usable {@code password_hash} — and a passwordless account is <em>not</em> thereby unreachable.
     * It has a mobile number, and {@code POST /auth/login} needs no password at all. A maker who
     * typed their own number into the create form would hold the account outright the moment the
     * checker approved it, and the checker would have no way to tell: everything they were shown was
     * a name, an email and a role. Refusing here is what makes the co-signature attest to a person.
     *
     * <p>Placed after the approval check so a colleague who is both unapproved and un-redeemed is
     * told the thing an administrator can act on. Both must be satisfied; neither implies the other,
     * and the account can clear them in either order.
     *
     * <p>An account with no row is not subject to the invite flow — every account created before
     * V71, and every consumer account. The query is phrased as "is there an open row" precisely so
     * that absence answers {@code false}.
     */
    private void refuseIfInviteIsStillOpen(User user) {
        if (invites.existsByUserIdAndRedeemedAtIsNull(user.getId())) {
            throw new ForbiddenException(
                    "This account has not been activated yet. Use the invite link you were sent to "
                            + "choose a password, then sign in.");
        }
    }
}
