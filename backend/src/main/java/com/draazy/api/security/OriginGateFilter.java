package com.draazy.api.security;

import com.draazy.api.common.error.ErrorCodes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

public class OriginGateFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(OriginGateFilter.class);

    static final String HEADER = "X-Proxy-Auth";

    static final int MIN_SECRET_LENGTH = 32;

    private static final Set<String> PROBE_METHODS = Set.of("GET", "HEAD");

    private static final Set<String> PROBES = Set.of(
            "/actuator/health", "/actuator/health/liveness", "/actuator/health/readiness");

    private final byte[] secret;

    private OriginGateFilter(String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    static Optional<OriginGateFilter> fromSetting(String setting) {
        String value = setting == null ? "" : setting.trim();
        if (value.isEmpty()) {
            throw new IllegalStateException(
                    "draazy.security.origin-secret must be set: 'none' when nothing proxies this "
                            + "instance, otherwise the secret the edge proxy sends as " + HEADER);
        }
        if (TrustedProxyConfig.NO_PROXY.equalsIgnoreCase(value)) {
            log.info("Origin gate: off. Any caller that can reach this instance is served.");
            return Optional.empty();
        }
        if (value.length() < MIN_SECRET_LENGTH) {
            throw new IllegalStateException("draazy.security.origin-secret must be at least "
                    + MIN_SECRET_LENGTH + " characters; a short one can be brute-forced.");
        }
        log.info("Origin gate: on. Requests without a valid {} header are refused.", HEADER);
        return Optional.of(new OriginGateFilter(value));
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return PROBE_METHODS.contains(request.getMethod())
                && PROBES.contains(WriteRateLimitFilter.normalisedPath(
                request.getContextPath(), request.getRequestURI()));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String presented = request.getHeader(HEADER);
        if (presented != null
                && MessageDigest.isEqual(secret, presented.getBytes(StandardCharsets.UTF_8))) {
            chain.doFilter(request, response);
            return;
        }
        SecurityErrors.write(response, 403, ErrorCodes.FORBIDDEN,
                ErrorCodes.Messages.ACCESS_DENIED);
    }
}
