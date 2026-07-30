package com.punenest.api.identity.auth;

import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.security.JwtService;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserMapper;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.identity.user.UserService;
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

    private final UserRepository users;
    private final UserService userService;
    private final UserMapper userMapper;
    private final OtpService otpService;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokens;
    private final PasswordEncoder passwordEncoder;

    public AuthService(UserRepository users, UserService userService, UserMapper userMapper,
            OtpService otpService, JwtService jwtService, RefreshTokenService refreshTokens,
            PasswordEncoder passwordEncoder) {
        this.users = users;
        this.userService = userService;
        this.userMapper = userMapper;
        this.otpService = otpService;
        this.jwtService = jwtService;
        this.refreshTokens = refreshTokens;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * Dual-mode mobile-OTP login (contract {@code POST /auth/login}). No OTP present ⇒ send a code and
     * acknowledge; OTP present ⇒ verify it, find-or-create the account, and issue tokens.
     *
     * <p>{@code noRollbackFor} the two OTP-verification errors: their handlers mutate the OTP row
     * (recording a failed attempt / burning a capped code) and that bookkeeping <em>must</em> survive
     * the thrown 401/429 — otherwise the per-code attempt cap silently resets every request and the
     * brute-force ceiling is lost. All other failures roll back as usual.
     */
    @Transactional(noRollbackFor = {UnauthorizedException.class, RateLimitedException.class})
    public AuthResponse login(LoginRequest request) {
        if (!request.hasOtp()) {
            otpService.sendLoginCode(request.mobile());
            return AuthResponse.otpAck();
        }
        otpService.verifyLoginCode(request.mobile(), request.otp());
        User user = findOrProvision(request.mobile());
        return issueFor(user);
    }

    /** Internal staff/admin email+password login (contract {@code POST /auth/staff-login}). */
    @Transactional
    public AuthResponse staffLogin(StaffLoginRequest request) {
        User user = users.findByEmailAndArchivedFalse(request.email())
                .orElseThrow(() -> new UnauthorizedException("Invalid credentials"));
        // why: never reveal which half failed; a null hash (passwordless account) must also 401, not NPE.
        if (user.getPasswordHash() == null
                || !passwordEncoder.matches(request.password(), user.getPasswordHash())) {
            throw new UnauthorizedException("Invalid credentials");
        }
        return issueFor(user);
    }

    /** Rotate a refresh token and mint a new access token (contract {@code POST /auth/refresh}). */
    @Transactional
    public AuthResponse refresh(RefreshRequest request) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(request.refreshToken());
        User user = users.findById(rotation.userId())
                .orElseThrow(() -> new UnauthorizedException("Invalid refresh token"));
        String access = jwtService.issueAccessToken(user);
        return AuthResponse.tokens(access, rotation.refreshToken(),
                jwtService.accessTtl().toSeconds(), userMapper.toResponse(user));
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
        user.setLastActive(Instant.now());
        String access = jwtService.issueAccessToken(user);
        String refresh = refreshTokens.issue(user.getId());
        return AuthResponse.tokens(access, refresh,
                jwtService.accessTtl().toSeconds(), userMapper.toResponse(user));
    }
}
