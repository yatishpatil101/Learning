package com.punenest.api.identity.auth;

import com.punenest.api.common.error.UnauthorizedException;
import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
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

/**
 * Identity &amp; Access endpoints (contract operations {@code login}, {@code staffLogin},
 * {@code refresh}, {@code logout}). Thin by design: it validates the request envelope and delegates
 * all logic to {@link AuthService}; the three login/refresh ops are public ({@code security: []} in the
 * spec, permitted in {@code SecurityConfig}), while {@code logout} requires an authenticated principal.
 * Error shaping (401/422/429 envelopes) is handled centrally by the global exception advice.
 *
 * <p>The one piece of logic that does live here is the refresh <em>cookie</em>. It is a transport
 * decision, not a session decision — {@link AuthService} mints and rotates tokens without caring how
 * they travel — so the {@code Set-Cookie} is attached at the edge and nowhere else. See
 * {@link RefreshCookie} for why the refresh half is {@code HttpOnly} while the access half is not.
 */
@RestController
public class AuthController {

    private final AuthService authService;
    private final StaffInviteService staffInvites;
    private final RefreshCookie refreshCookie;
    private final RefreshOriginGate refreshOrigins;

    public AuthController(AuthService authService, StaffInviteService staffInvites,
            RefreshCookie refreshCookie, RefreshOriginGate refreshOrigins) {
        this.authService = authService;
        this.staffInvites = staffInvites;
        this.refreshCookie = refreshCookie;
        this.refreshOrigins = refreshOrigins;
    }

    /** {@code POST /auth/login} — dual-mode: {mobile} sends an OTP; {mobile,otp} verifies + issues tokens. */
    @PostMapping(Routes.Auth.LOGIN)
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return withRefreshCookie(authService.login(request), request.rememberDevice());
    }

    /** {@code POST /auth/staff-login} — internal email+password authentication. */
    @PostMapping(Routes.Auth.STAFF_LOGIN)
    public ResponseEntity<AuthResponse> staffLogin(@Valid @RequestBody StaffLoginRequest request) {
        return withRefreshCookie(authService.staffLogin(request), request.rememberDevice());
    }

    /**
     * {@code POST /auth/refresh} — rotate the refresh token and mint a fresh access token.
     *
     * <p>The credential is the cookie, so a request without one is not a malformed body (422) but an
     * absent session (401) — which is also what the client does with a spent or stolen token, so all
     * three failures leave it on the same recovery path.
     *
     * <p>Every refusal also clears the readable session hint. Without that a client holding a hint
     * whose token has been revoked — by a sign-out elsewhere, by reuse-detection burning the family,
     * or simply by expiry — asks this endpoint again on every cold boot, forever, because nothing
     * else would ever tell it to stop. The clear rides on the 401 rather than the happy path for the
     * same reason the hint exists at all: the browser will not act on what it cannot see, and the
     * only authoritative statement that a session is over is this one.
     *
     * <p>The origin gate runs before any of that, and before the cookie is so much as read, because
     * this is the one endpoint on the API whose credential the browser supplies by itself — so it is
     * the one endpoint a same-site page can drive on a victim's behalf. {@link RefreshOriginGate}
     * explains what that buys an attacker and why {@code SameSite=Lax} does not stop it.
     */
    @PostMapping(Routes.Auth.REFRESH)
    public ResponseEntity<AuthResponse> refresh(
            @RequestBody(required = false) RefreshRequest request,
            HttpServletRequest httpRequest,
            HttpServletResponse response) {
        refreshOrigins.check(httpRequest);
        String presented = refreshCookie.presented(httpRequest);
        // Added to the servlet response rather than a ResponseEntity because the refusals below are
        // exceptions; the handler that turns them into a 401 writes to this same response, so
        // headers set here survive it.
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

    /**
     * Expire the readable hint, but only for a request that could plausibly be our own page.
     *
     * <p>{@code SameSite=Lax} governs whether a cookie is <em>sent</em>, not whether one may be
     * <em>set</em>. Without the gate, any third-party page can POST here cross-site, watch Lax
     * correctly withhold the refresh cookie, and have the resulting 401 delete the victim's hint
     * from their own jar — a forced loss of the ITP recovery, triggered from a site we have nothing
     * to do with. The refresh cookie survives, so the ceiling is "sign in again", but it is a write
     * primitive handed out for free.
     *
     * <p>Gating on the fetch metadata rather than on "was a token actually presented" is deliberate:
     * an <em>expired</em> refresh cookie is not in the jar at all, so that alternative would skip
     * the clear in the commonest case and restore the forever-401 loop this exists to stop. A
     * browser too old to send {@code Sec-Fetch-Site} sends nothing, and is treated as ours — the
     * same browser cannot be the modern cross-site attacker this is guarding against.
     */
    private void clearHint(HttpServletRequest request, HttpServletResponse response) {
        String site = request.getHeader("Sec-Fetch-Site");
        if (site != null && !"same-origin".equals(site) && !"same-site".equals(site)
                && !"none".equals(site)) {
            return;
        }
        response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie.clearedHint().toString());
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
    public ResponseEntity<Void> logout(@CurrentUser AuthPrincipal principal) {
        authService.logout(principal.userId());
        // Clear the cookie as well as the server-side family. Revoking alone would leave the browser
        // holding a dead token it re-sends on every refresh attempt — harmless, but it turns a
        // deliberate sign-out into a request that looks like reuse-detection tripping.
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, refreshCookie.cleared().toString())
                .header(HttpHeaders.SET_COOKIE, refreshCookie.clearedHint().toString())
                .build();
    }

    /**
     * Attach the rotated refresh token as a cookie, when there is one.
     *
     * <p>The OTP-send step of {@code /auth/login} answers {@code {"otpSent":true}} and has issued
     * nothing yet, so it must not touch the cookie: overwriting a live session's token with a blank
     * one because somebody started a second sign-in would sign them out of the first.
     * <p>The readable session hint rides along on the same responses, never on its own: it is a
     * claim that {@link RefreshCookie#NAME} is in the jar, so the two are only ever written together
     * and a client that trusts the hint is never sent looking for a token that was not issued.
     */
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
