package com.punenest.api.security;

import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Resolves the {@code Authorization: Bearer <jwt>} header into a Spring Security authentication on
 * every request. A valid token yields an {@link AuthPrincipal} with a single {@code ROLE_<role>}
 * authority (so {@code @PreAuthorize("hasRole('ADMIN')")} works); anything invalid is left
 * unauthenticated and the entry point returns 401 for protected routes. The filter never throws —
 * a bad token is simply "no auth", not a 500.
 *
 * <p><strong>The role comes from the database, not from the token</strong> (tech debt D201). The
 * token says who the caller was when it was minted; {@link RoleSource} says what they are now, and
 * this is the one place both the route guards and the two capability resolvers read it from, so
 * resolving it here fixes all of them at once and adds no second mechanism to keep in step. Before
 * this, a permission taken away in the back office landed on the caller's next request while a role
 * change taken away in the same screen did not land until their token expired — the two gestures sit
 * side by side in the console and behaved differently.
 *
 * <p>Read per request rather than cached, for the same reason {@link PermissionMap} and
 * {@code AccountPermissions} are: a cache is a window during which a revocation has visibly been
 * made and is not yet true.
 *
 * <p><strong>A failure to read it is not caught here.</strong> {@link PermissionMap} swallows a
 * malformed document because a typo in a hand-edited config row must not be an outage; this is not
 * that. The only way this lookup fails is the database being unreachable, and a request whose
 * authorisation could not be established must not proceed as though it had — every controller behind
 * this filter needs the same database anyway, so falling back would trade a 500 for a 500 and grant
 * whatever the token asked for on the way.
 */
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";
    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

    private final JwtService jwtService;
    private final RoleSource roles;

    public JwtAuthFilter(JwtService jwtService, RoleSource roles) {
        this.jwtService = jwtService;
        this.roles = roles;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith(BEARER)
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            try {
                AuthPrincipal principal =
                        current(jwtService.parse(header.substring(BEARER.length())));
                var authority = new SimpleGrantedAuthority("ROLE_" + principal.role().toUpperCase());
                var auth = new UsernamePasswordAuthenticationToken(
                        principal, null, List.of(authority));
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (JwtException | IllegalArgumentException ex) {
                // ponytail: an unparseable token means "anonymous"; downstream authz decides. Not an
                // error path (probing/expired tokens are routine) so log at DEBUG, never WARN/ERROR.
                log.debug("Rejecting bearer token: {}", ex.getMessage());
                SecurityContextHolder.clearContext();
            }
        }
        chain.doFilter(request, response);
    }

    /**
     * The same principal with the account's current role substituted for the claimed one.
     *
     * <p>No row means the database has nothing to say, and the claim stands — see
     * {@link RoleSource#roleOf}. Only the role is re-resolved: {@code team} is a staff account's
     * desk rather than a privilege level, and every guard that reads it is already gated on a role
     * this method has just confirmed.
     */
    private AuthPrincipal current(AuthPrincipal claimed) {
        String role = roles.roleOf(claimed.userId()).orElse(claimed.role());
        if (role.equals(claimed.role())) {
            return claimed;
        }
        return new AuthPrincipal(claimed.userId(), role, claimed.team(),
                claimed.mobileVerified(), claimed.aadhaarVerified());
    }
}
