package com.draazy.api.security;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.web.Routes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Refuses state-changing requests while the {@code maintenanceMode} flag is on — the half that holds
 * against an open tab, a script or curl. Exemptions and why 503: docs/system/cross-cutting.md §8.6.
 */
public class MaintenanceModeFilter extends OncePerRequestFilter {

    /** Shared with {@link WriteRateLimitFilter}: one answer to "can this request change state". */
    private static final Set<String> MUTATING = WriteRateLimitFilter.MUTATING;

    /**
     * Server-to-server callbacks. Listed by route constant rather than by prefix: a hole in a
     * maintenance gate should be exactly two paths wide.
     */
    private static final Set<String> PROVIDER_CALLBACKS =
            Set.of(Routes.Webhooks.CASHFREE_PAYMENT);

    /** Credential routes, exempt so the window can be ended by somebody who is not signed in yet. */
    private static final String AUTH_PREFIX = "/auth/";

    private static final Set<String> INTERNAL_AUTHORITIES = Set.of("ROLE_ADMIN", "ROLE_STAFF");

    private final PlatformSettings settings;

    public MaintenanceModeFilter(PlatformSettings settings) {
        this.settings = settings;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (isExempt(request) || !settings.maintenanceMode()) {
            chain.doFilter(request, response);
            return;
        }
        SecurityErrors.write(response, 503, ErrorCodes.MAINTENANCE_MODE,
                "The site is down for maintenance. Please try again shortly.");
    }

    /**
     * Whether this request is outside the gate — checked before the flag is read, so an exempt
     * caller costs no query at all.
     */
    private static boolean isExempt(HttpServletRequest request) {
        if (!MUTATING.contains(request.getMethod())) {
            return true;
        }
        String path = WriteRateLimitFilter.normalisedPath(
                request.getContextPath(), request.getRequestURI());
        return path.startsWith(AUTH_PREFIX) || PROVIDER_CALLBACKS.contains(path) || isInternal();
    }

    private static boolean isInternal() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) {
            return false;
        }
        return auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .anyMatch(INTERNAL_AUTHORITIES::contains);
    }
}
