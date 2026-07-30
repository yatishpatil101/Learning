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
 */
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";
    private static final Logger log = LoggerFactory.getLogger(JwtAuthFilter.class);

    private final JwtService jwtService;

    public JwtAuthFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith(BEARER)
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            try {
                AuthPrincipal principal = jwtService.parse(header.substring(BEARER.length()));
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
}
