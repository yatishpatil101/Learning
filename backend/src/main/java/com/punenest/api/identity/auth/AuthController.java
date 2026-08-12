package com.punenest.api.identity.auth;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Identity &amp; Access endpoints (contract operations {@code login}, {@code staffLogin},
 * {@code refresh}, {@code logout}). Thin by design: it validates the request envelope and delegates
 * all logic to {@link AuthService}; the three login/refresh ops are public ({@code security: []} in the
 * spec, permitted in {@code SecurityConfig}), while {@code logout} requires an authenticated principal.
 * Error shaping (401/422/429 envelopes) is handled centrally by the global exception advice.
 */
@RestController
public class AuthController {

    private final AuthService authService;
    private final StaffInviteService staffInvites;

    public AuthController(AuthService authService, StaffInviteService staffInvites) {
        this.authService = authService;
        this.staffInvites = staffInvites;
    }

    /** {@code POST /auth/login} — dual-mode: {mobile} sends an OTP; {mobile,otp} verifies + issues tokens. */
    @PostMapping(Routes.Auth.LOGIN)
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request);
    }

    /** {@code POST /auth/staff-login} — internal email+password authentication. */
    @PostMapping(Routes.Auth.STAFF_LOGIN)
    public AuthResponse staffLogin(@Valid @RequestBody StaffLoginRequest request) {
        return authService.staffLogin(request);
    }

    /** {@code POST /auth/refresh} — rotate the refresh token and mint a fresh access token. */
    @PostMapping(Routes.Auth.REFRESH)
    public AuthResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return authService.refresh(request);
    }

    /**
     * {@code POST /auth/staff-invite/redeem} — a new back-office colleague sets their own password
     * (tech debt D206). Returns 204.
     *
     * <p>Public, and it has to be: the caller has no credential yet. It also returns <em>nothing</em>
     * — not the account, not a token. Answering with the user would tell whoever holds the token
     * whose account it was, and answering with a session would let a colleague whose account is
     * still awaiting a second administrator sign in around that gate. Redeeming sets a password; it
     * is not a login.
     */
    @PostMapping(Routes.Auth.STAFF_INVITE_REDEEM)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void redeemStaffInvite(@Valid @RequestBody StaffInviteRedeemRequest request) {
        staffInvites.redeem(request.token(), request.password());
    }

    /** {@code POST /auth/logout} — revoke the caller's refresh-token family. Returns 204. */
    @PostMapping(Routes.Auth.LOGOUT)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@CurrentUser AuthPrincipal principal) {
        authService.logout(principal.userId());
    }
}
