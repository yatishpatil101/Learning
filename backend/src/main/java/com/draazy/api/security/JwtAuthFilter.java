package com.draazy.api.security;

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
 * Resolves {@code Authorization: Bearer <jwt>} into a Spring Security authentication on every
 * request. Rationale: docs/system/cross-cutting.md#jwt-auth-filter.
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
     * The same principal with the account's current role substituted for the claimed one. No row
     * means the database has nothing to say and the claim stands; only the role is re-resolved.
     */
    private AuthPrincipal current(AuthPrincipal claimed) {
        String role = roles.roleOf(claimed.userId()).orElse(claimed.role());
        if (role.equals(claimed.role())) {
            return claimed;
        }
        return new AuthPrincipal(claimed.userId(), role, claimed.team(),
                claimed.mobileVerified(), claimed.verified());
    }
}
