package com.draazy.api.identity.auth;

import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BotDefence;
import com.draazy.api.security.BotDefenceFilter;
import com.draazy.api.security.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** The refresh cookie is a transport decision, so {@code Set-Cookie} is attached here and nowhere else;
 * {@link RefreshCookie} explains why only the refresh half is {@code HttpOnly}. */
@RestController
public class AuthController {

    private final AuthService authService;
    private final StaffSignInService staffSignIn;
    private final StaffInviteService staffInvites;
    private final RefreshCookie refreshCookie;
    private final RefreshOriginGate refreshOrigins;
    private final BotDefence botDefence;

    public AuthController(AuthService authService, StaffSignInService staffSignIn,
            StaffInviteService staffInvites, RefreshCookie refreshCookie,
            RefreshOriginGate refreshOrigins, BotDefence botDefence) {
        this.authService = authService;
        this.staffSignIn = staffSignIn;
        this.staffInvites = staffInvites;
        this.refreshCookie = refreshCookie;
        this.refreshOrigins = refreshOrigins;
        this.botDefence = botDefence;
    }

    /** {@code POST /auth/login} — dual-mode: {mobile} sends an OTP; {mobile,otp} verifies + issues tokens. */
    @PostMapping(Routes.Auth.LOGIN)
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request,
            HttpServletRequest http) {
        // Only the send step spends an SMS; verify is held by the per-code guess cap instead.
        if (!request.hasOtp() && !BotDefenceFilter.verified(botDefence, http)) {
            throw new ForbiddenException(BotDefenceFilter.REFUSAL);
        }
        return withRefreshCookie(authService.login(request), request.rememberDevice());
    }

    /** {@code POST /auth/staff-login} — step one: email + password earns a second-factor challenge. */
    @PostMapping(Routes.Auth.STAFF_LOGIN)
    public AuthResponse staffLogin(@Valid @RequestBody StaffLoginRequest request) {
        return staffSignIn.checkPassword(request);
    }

    /** {@code POST /auth/staff-login/verify} — authenticator or recovery code; issues tokens. */
    @PostMapping(Routes.Auth.STAFF_LOGIN_VERIFY)
    public ResponseEntity<AuthResponse> staffLoginVerify(@Valid @RequestBody StaffCodeRequest request) {
        return withRefreshCookie(staffSignIn.verify(request), request.rememberDevice());
    }

    /** {@code POST /auth/staff-login/enrol} — a new authenticator secret for a first sign-in. */
    @PostMapping(Routes.Auth.STAFF_LOGIN_ENROL)
    public StaffTotpEnrolment staffLoginEnrol(@Valid @RequestBody StaffEnrolRequest request) {
        return staffSignIn.startEnrolment(request);
    }

    /** {@code POST /auth/staff-login/enrol/confirm} — first code from the new app; issues tokens. */
    @PostMapping(Routes.Auth.STAFF_LOGIN_ENROL_CONFIRM)
    public ResponseEntity<AuthResponse> staffLoginConfirm(@Valid @RequestBody StaffCodeRequest request) {
        return withRefreshCookie(staffSignIn.confirmEnrolment(request), request.rememberDevice());
    }

    /** The origin gate runs before the cookie is read: the browser supplies this credential by itself
     * ({@link RefreshOriginGate}). Every refusal clears the hint, or a revoked session retries forever. */
    @PostMapping(Routes.Auth.REFRESH)
    public ResponseEntity<AuthResponse> refresh(
            @RequestBody(required = false) RefreshRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse response) {
        refreshOrigins.check(httpRequest);
        String presented = refreshCookie.presented(httpRequest);
        // On the servlet response, not a ResponseEntity: the 401 handler writes to this same response.
        if (presented == null) {
            clearHint(httpRequest, response);
            throw new UnauthorizedException("Invalid refresh token");
        }
        try {
            return withRefreshCookie(authService.refresh(presented),
                    RefreshRequest.rememberDevice(request));
        } catch (UnauthorizedException e) {
            clearHint(httpRequest, response);
            throw e;
        }
    }

    /** Lax governs sending, not setting, so ungated any cross-site POST could delete the victim's hint. Gated on
     * fetch metadata because an expired refresh cookie is absent; no {@code Sec-Fetch-Site} counts as ours. */
    private void clearHint(HttpServletRequest request, HttpServletResponse response) {
        String site = request.getHeader("Sec-Fetch-Site");
        if (site != null && !"same-origin".equals(site) && !"same-site".equals(site)
                && !"none".equals(site)) {
            return;
        }
        response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie.clearedHint().toString());
    }

    /** Returns nothing: the account would tell the token holder whose it was, and a session would skip
     * first-factor sign-in and TOTP enrolment. */
    @PostMapping(Routes.Auth.STAFF_INVITE_REDEEM)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void redeemStaffInvite(@Valid @RequestBody StaffInviteRedeemRequest request) {
        staffInvites.redeem(request.token(), request.password());
    }

    /** {@code POST /auth/logout} — revoke the caller's refresh-token family. Returns 204. */
    @PostMapping(Routes.Auth.LOGOUT)
    public ResponseEntity<Void> logout(@CurrentUser AuthPrincipal principal) {
        authService.logout(principal.userId());
        // Clearing the cookie too keeps a sign-out from later looking like reuse-detection tripping.
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, refreshCookie.cleared().toString())
                .header(HttpHeaders.SET_COOKIE, refreshCookie.clearedHint().toString())
                .build();
    }

    /** The OTP-send step issues nothing, so it must not blank a live session's cookie. The hint is only
     * written with the token, so a client trusting it is never sent after one that was not issued. */
    private ResponseEntity<AuthResponse> withRefreshCookie(AuthResponse body, boolean remember) {
        if (body.refreshToken() == null) {
            return ResponseEntity.ok(body);
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, refreshCookie.issued(body.refreshToken(), remember).toString())
                .header(HttpHeaders.SET_COOKIE, refreshCookie.issuedHint(remember).toString())
                .body(body);
    }
}
