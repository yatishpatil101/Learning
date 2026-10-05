package com.draazy.api.security;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.web.Routes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

public class BotDefenceFilter extends OncePerRequestFilter {

    // The header the Turnstile widget's token is expected in.
    static final String TOKEN_HEADER = "CF-Turnstile-Response";

    // Longest token this will forward to the provider.
    // Turnstile tokens are a few hundred characters.
    private static final int MAX_TOKEN_LENGTH = 4096;

    // Every entry is an unauthenticated `permitAll` write in `SecurityConfig`.
    private static final Set<String> CHALLENGED = Set.of(
            Routes.Auth.LOGIN,
            Routes.Cities.WAITLIST,
            Routes.ServiceWaitlist.BASE);

    private static final Logger log = LoggerFactory.getLogger(BotDefenceFilter.class);

    private final BotDefence defence;

    public BotDefenceFilter(BotDefence defence) {
        this.defence = defence;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {

        // Check enforcement first so dev and tests pay only one boolean read.
        if (!defence.enforced() || !isChallenged(request)) {
            chain.doFilter(request, response);
            return;
        }

        String token = request.getHeader(TOKEN_HEADER);
        if (token == null || token.isBlank() || token.length() > MAX_TOKEN_LENGTH) {

            // Missing tokens are rejected; otherwise omitting the header would bypass the gate.
            reject(response);
            return;
        }

        if (!defence.verify(token, request.getRemoteAddr())) {
            reject(response);
            return;
        }

        chain.doFilter(request, response);
    }

    // Share the path normaliser with rate limits so route matching cannot drift.
    // Method-check too: some challenged paths also serve safe methods.
    private static boolean isChallenged(HttpServletRequest request) {
        return "POST".equals(request.getMethod())
                && CHALLENGED.contains(
                        WriteRateLimitFilter.normalisedPath(
                                request.getContextPath(), request.getRequestURI()));
    }

    // One refusal for every reason, deliberately.
    // Missing token, rejected token and unreachable provider produce a byte-identical response.
    private static void reject(HttpServletResponse response) throws IOException {
        log.debug("Bot defence refused a challenged write");
        SecurityErrors.write(response, 403, ErrorCodes.FORBIDDEN,
                "This request could not be verified as human. Please reload the page and try again.");
    }
}
