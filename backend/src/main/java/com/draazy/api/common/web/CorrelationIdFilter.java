package com.draazy.api.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Establishes a correlation id for every request: reuse an inbound {@code X-Trace-Id} (so a trace
 * spans the frontend → API hop) or mint one. The id lives in the SLF4J {@link MDC} for the whole
 * request (so every log line and the error envelope's {@code traceId} carry it) and is echoed back
 * in the response header.
 *
 * <p>Runs at highest precedence — before the Spring Security chain — so even 401/403 responses
 * produced by the security entry points already have a trace id in the MDC.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {

    /**
     * Whitelist for an inbound trace id we're willing to echo back. Rejecting anything with CR/LF or
     * exotic characters closes an HTTP response-splitting vector (an attacker-supplied header being
     * reflected into the response) and keeps the id log-safe. Anything else is replaced with a UUID.
     */
    private static final Pattern SAFE_TRACE_ID = Pattern.compile("^[A-Za-z0-9_-]{1,128}$");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String traceId = request.getHeader(RequestCorrelation.TRACE_ID_HEADER);
        if (!StringUtils.hasText(traceId) || !SAFE_TRACE_ID.matcher(traceId).matches()) {
            traceId = UUID.randomUUID().toString();
        }
        MDC.put(RequestCorrelation.TRACE_ID_MDC, traceId);
        response.setHeader(RequestCorrelation.TRACE_ID_HEADER, traceId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(RequestCorrelation.TRACE_ID_MDC);
        }
    }
}
