package com.draazy.api.identity.auth;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.security.JwtService;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.SelfProfile;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.user.UserService;
import com.draazy.api.identity.user.UserStatuses;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Mints every session but owns none of the crypto; staff sign-in calls {@link #issueFor} after its second factor.
 * Refusals, rollback rules and enumeration-oracle reasoning: docs/flows/consumer/auth.md */
@Service
public class AuthService {

    private final UserRepository users;
    private final UserService userService;
    private final SelfProfile selfProfile;
    private final OtpService otpService;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokens;
    private final StaffInviteRepository invites;
    private final PlatformSettings platformSettings;

    public AuthService(UserRepository users, UserService userService, SelfProfile selfProfile,
            OtpService otpService, JwtService jwtService, RefreshTokenService refreshTokens,
            StaffInviteRepository invites, PlatformSettings platformSettings) {
        this.users = users;
        this.userService = userService;
        this.selfProfile = selfProfile;
        this.otpService = otpService;
        this.jwtService = jwtService;
        this.refreshTokens = refreshTokens;
        this.invites = invites;
        this.platformSettings = platformSettings;
    }

    /** Every listed {@code noRollbackFor} type is load-bearing: see docs/flows/consumer/auth.md. */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class,
            ForbiddenException.class, OtpSender.DeliveryFailedException.class})
    public AuthResponse login(LoginRequest request) {
        // Canonicalise once so OTP send, OTP verify and the account lookup all key off the same ten
        // digits regardless of how the caller spaced or prefixed them.
        String mobile = MobileMask.normalise(request.mobile());
        if (!request.hasOtp()) {
            otpService.sendLoginCode(mobile);
            return AuthResponse.otpAck(otpService.resendCooldownSeconds());
        }
        otpService.verifyLoginCode(mobile, request.otp());
        User user = findOrProvision(mobile);
        // After the OTP, so the refusal tells only the phone's holder that this is a staff number.
        if (Roles.isBackOffice(user.getRole())) {
            throw new ForbiddenException(ErrorCodes.STAFF_SIGN_IN_REQUIRED,
                    "Staff, manager and administrator accounts sign in at Staff sign-in with email, password "
                            + "and authenticator code.");
        }
        return issueFor(user);
    }

    /** {@code noRollbackFor} the 401 so the two revocations on this path survive it: see the auth flow doc. */
    @Transactional(noRollbackFor = UnauthorizedException.class)
    public AuthResponse refresh(String presentedToken) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(presentedToken);
        User user = users.findByIdAndArchivedFalse(rotation.userId()).orElse(null);
        if (user == null) {
            refreshTokens.revokeAllForUser(rotation.userId());
            throw new UnauthorizedException("Invalid refresh token");
        }
        // The same gate again: "a refresh token can only exist if issueFor minted one" is true by
        // accident of today's write paths and nothing enforces it.
        refuseIfCannotYetAuthenticate(user);
        String access = jwtService.issueAccessToken(user);
        return AuthResponse.tokens(access, rotation.refreshToken(),
                jwtService.accessTtl().toSeconds(), selfProfile.forSession(user));
    }

    /** Best-effort session kill (contract {@code POST /auth/logout}): revoke the user's refresh family. */
    @Transactional
    public void logout(UUID userId) {
        refreshTokens.revokeAllForUser(userId);
    }

    /** {@code signupsEnabled} is enforced here, and only here: see the auth flow doc. */
    private User findOrProvision(String mobile) {
        User user = users.findByMobile(mobile).map(existing -> {
            if (existing.isArchived()) {
                throw new UnauthorizedException(ErrorCodes.ACCOUNT_ARCHIVED, "Account is archived");
            }
            existing.setMobileVerified(true);
            return existing;
        }).orElseGet(() -> {
            if (!platformSettings.signupsEnabled()) {
                throw new ForbiddenException(ErrorCodes.SIGNUPS_CLOSED,
                        "New accounts are closed at the moment. If you already have one, sign in "
                                + "with the number you registered; otherwise contact support.");
            }
            try {
                return userService.provisionBuyer(mobile);
            } catch (DataIntegrityViolationException race) {
                // A concurrent first sign-in inserted this mobile first — adopt the winner's row.
                // Its REQUIRES_NEW tx rolled back in isolation, so ours is clean.
                return users.findByMobileAndArchivedFalse(mobile)
                        .orElseThrow(() -> new UnauthorizedException(ErrorCodes.ACCOUNT_ARCHIVED,
                                "Account is archived"));
            }
        });
        return user;
    }

    /** Mint an access+refresh pair for an authenticated user and stamp last-active. */
    AuthResponse issueFor(User user) {
        refuseIfCannotYetAuthenticate(user);
        user.setLastActive(Instant.now());
        String access = jwtService.issueAccessToken(user);
        String refresh = refreshTokens.issue(user.getId());
        // SelfProfile, not the bare mapper: the client caches the embedded user as its session
        // identity, and a sign-in missing the back-office atoms leaves the console sidebar empty.
        return AuthResponse.tokens(access, refresh,
                jwtService.accessTtl().toSeconds(), selfProfile.forSession(user));
    }

    void refuseIfCannotYetAuthenticate(User user) {
        refuseIfSuspended(user);
        refuseIfInviteIsStillOpen(user);
    }

    /** Deliberately unspecific: the reason lives in {@code audit_log}. See docs/flows/consumer/auth.md. */
    private void refuseIfSuspended(User user) {
        if (UserStatuses.SUSPENDED.equals(user.getStatus())) {
            throw new ForbiddenException(
                    "This account has been suspended. Contact support if you think that is a "
                            + "mistake.");
        }
    }

    private void refuseIfInviteIsStillOpen(User user) {
        if (invites.existsByUserIdAndRedeemedAtIsNull(user.getId())) {
            throw new ForbiddenException(
                    "This account has not been activated yet. Use the invite link you were sent to "
                            + "choose a password, then sign in.");
        }
    }
}
