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

/**
 * Demands a solved challenge on the writes that anyone on the internet may post to (tech-debt D130).
 *
 * <p><strong>The gap this closes.</strong> Rate limiting (D2/D158) throttles a caller; it does not
 * ask whether the caller is a person. The forms below are the only writes on the platform that
 * accept an anonymous body, and each of them ends in something that costs real money or reaches a
 * real person — a lead row a salesperson rings, a waitlist a city launch is planned from, a login
 * attempt against a real account. A script can fill any of them at whatever rate the limiter allows,
 * forever, from as many addresses as it likes. That is the shape a challenge answers and a limiter
 * cannot.
 *
 * <p><strong>The protected set is an allow-list, and small on purpose.</strong> The temptation is to
 * apply this to every write and be done. That would be a serious mistake: an authenticated caller
 * has already proved they are a person once, holds a token that identifies them, and is rate-limited
 * against that identity — so a challenge adds nothing there and subtracts a great deal. It would
 * mean every mutating call the app makes needs a fresh widget token, so a background save, a retry
 * after a token expiry, the mobile app and every integration break at once, and they break with a
 * 403 that reads like an authorisation bug. This filter therefore matches three exact paths, and a
 * fourth must be added here deliberately rather than inherited by a prefix.
 *
 * <p><strong>What is deliberately excluded.</strong> {@code POST /auth/refresh} is public but is
 * called by the app with no user present, so there is nobody to solve a challenge — gating it would
 * log everyone out the moment their access token expired. The two Cashfree callbacks are public but
 * server-to-server: there is no browser, so there can be no widget, and their authenticity comes
 * from an HMAC over the body. {@code POST /auth/staff-login} is left out for a blunter reason —
 * it is the door ops use, the widget is not wired into that surface yet, and a control that locks
 * out the people who would have to fix it is worse than the risk it removes. It is one constant away
 * once the staff console carries the widget.
 *
 * <p><strong>The token arrives in a header, not the body.</strong> {@code CF-Turnstile-Response} is
 * read off the request, so not one request DTO, controller signature or OpenAPI schema changes to
 * accommodate this. That matters beyond tidiness: a challenge field threaded through three request
 * bodies is three places for it to be forgotten on the fourth form, and it would make the contract
 * describe a transport concern. A filter reading a header keeps the whole control in one file.
 *
 * <p><strong>Ordering.</strong> Registered after {@link JwtAuthFilter} and alongside
 * {@link WriteRateLimitFilter}, both of which run before authorisation. It matters only that the
 * rate limit is cheap and this is not: verification is a network call, so a flood should be refused
 * by the counter before it ever reaches this filter. On the paths matched here that ordering is
 * enforced by the limiter's own budget rather than by filter position.
 *
 * <p>Fail-open when unconfigured, fail-closed when configured — the reasoning is in
 * {@link BotDefence} and is not repeated here.
 */
public class BotDefenceFilter extends OncePerRequestFilter {

    /**
     * The header the Turnstile widget's token is expected in.
     *
     * <p>Cloudflare's own name for the field, so anyone who has read their documentation will look
     * for exactly this.
     */
    static final String TOKEN_HEADER = "CF-Turnstile-Response";

    /**
     * Longest token this will forward to the provider.
     *
     * <p>Turnstile tokens are a few hundred characters. Without a ceiling, a caller can make the
     * server post an arbitrarily large body to Cloudflare on demand — turning an unauthenticated
     * endpoint into an outbound amplifier and burning a request thread and a socket per attempt,
     * which is the denial of service the filter is supposed to prevent rather than provide. Header
     * size limits in the container bound this too, but only incidentally and only if they are never
     * raised.
     */
    private static final int MAX_TOKEN_LENGTH = 4096;

    /**
     * The exact paths that require a solved challenge, matched on the normalised path.
     *
     * <p>Every entry is an unauthenticated {@code permitAll} write in {@link SecurityConfig}. They
     * are referenced through {@link Routes} for the same reason the matchers there are: this file
     * and the controllers must agree on every path, and a literal that drifts leaves a form silently
     * unprotected with no test failing.
     */
    private static final Set<String> CHALLENGED = Set.of(
            Routes.Auth.LOGIN,
            Routes.Cities.WAITLIST,
            Routes.SocietyLeads.BASE,
            Routes.ServiceWaitlist.BASE);

    private static final Logger log = LoggerFactory.getLogger(BotDefenceFilter.class);

    private final BotDefence defence;

    public BotDefenceFilter(BotDefence defence) {
        this.defence = defence;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        // Checked before anything else so that the unconfigured platform — every developer machine
        // and the whole test suite — pays a single boolean read per request and takes no other
        // branch in this class.
        if (!defence.enforced() || !isChallenged(request)) {
            chain.doFilter(request, response);
            return;
        }

        String token = request.getHeader(TOKEN_HEADER);
        if (token == null || token.isBlank() || token.length() > MAX_TOKEN_LENGTH) {
            // Absent is refused, not waved through. This is the branch that decides whether the
            // control exists at all: treating "no token" as "no opinion" would mean any client that
            // simply omits the header is exempt, which is every script and no browser.
            reject(response);
            return;
        }

        if (!defence.verify(token, request.getRemoteAddr())) {
            reject(response);
            return;
        }

        chain.doFilter(request, response);
    }

    /**
     * POST-only, on an exact normalised path.
     *
     * <p>Method-checked as well as path-checked because two of these paths serve other methods that
     * must not be challenged, and normalised through {@link WriteRateLimitFilter#normalisedPath}
     * rather than compared raw: the dispatcher routes on the decoded path with matrix parameters
     * stripped, so a raw comparison sees {@code /society-lead%73} and {@code /society-leads;x=1} as
     * unknown paths while Spring routes both to the protected handler. Sharing that one helper is
     * deliberate — two normalisers would eventually disagree, and the one that disagreed quietly
     * would be this one.
     */
    private static boolean isChallenged(HttpServletRequest request) {
        return "POST".equals(request.getMethod())
                && CHALLENGED.contains(
                        WriteRateLimitFilter.normalisedPath(
                                request.getContextPath(), request.getRequestURI()));
    }

    /**
     * One refusal for every reason, deliberately.
     *
     * <p>Missing token, rejected token and unreachable provider produce a byte-identical response.
     * Distinguishing them would tell an attacker which of their attempts was closest to working —
     * in particular, an error that means "the provider is down" is an invitation to keep hammering
     * until it is. The operator gets the distinction in the log; the caller does not.
     *
     * <p>403 rather than 400: the request is well-formed and the server understood it perfectly, it
     * simply will not act on it. 401 would be wrong on an endpoint that has no authentication to
     * challenge, and would send well-behaved clients into a token-refresh loop.
     */
    private static void reject(HttpServletResponse response) throws IOException {
        log.debug("Bot defence refused a challenged write");
        SecurityErrors.write(response, 403, ErrorCodes.FORBIDDEN,
                "This request could not be verified as human. Please reload the page and try again.");
    }
}
