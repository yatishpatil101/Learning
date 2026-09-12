package com.draazy.api.security;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.web.Routes;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UriUtils;

/**
 * Caps how many mutating requests one caller may make in a window. Keying, budgets, exempt reads and
 * the path-normalisation bypasses it closes: docs/system/cross-cutting.md §8.5.
 */
public class WriteRateLimitFilter extends OncePerRequestFilter {

    /** Shared with {@link MaintenanceModeFilter}: one answer to "can this request change state". */
    static final Set<String> MUTATING = Set.of("POST", "PUT", "PATCH", "DELETE");

    /**
     * Reads limited anyway (enumeration defence, and one very expensive export). The export path is
     * a literal, so a rename fails open — {@code WriteRateLimitTest.dataExportIsLimited} catches it.
     */
    private static final Set<String> LIMITED_READS = Set.of(
            Routes.Documents.SHARED,
            "/me/data-export");

    /**
     * Provider callbacks, which get their own budget rather than an exemption: they cannot share a
     * bucket with users, and they are {@code permitAll} so they cannot be exempt either.
     */
    private static final Set<String> PROVIDER_CALLBACKS =
            Set.of(Routes.Webhooks.CASHFREE_DIGILOCKER, Routes.Webhooks.CASHFREE_PAYMENT);

    /**
     * How much more of the window a provider callback may use. Sized for a provider replaying a
     * backlog after an outage, all from one address, while still bounding an anonymous flood.
     */
    private static final int CALLBACK_BUDGET_MULTIPLIER = 50;

    /**
     * Ceiling on a provider callback body: nothing else bounds JSON in this stack. {@code 64L} keeps
     * the expression out of int overflow, where the bound would invert.
     */
    private static final long MAX_CALLBACK_BODY_BYTES = 64L * 1024;

    private static final Logger log = LoggerFactory.getLogger(WriteRateLimitFilter.class);

    private static final String FORWARDED_FOR = "X-Forwarded-For";

    private final WriteRateLimitStore limiter;
    private final WriteRateLimitStore callbackLimiter;
    private final Duration window;
    private final boolean proxyAware;
    private volatile boolean misconfigurationLogged;

    /** Counts in this instance's memory — the default, and what every test uses. */
    public WriteRateLimitFilter(int budget, Duration window, boolean proxyAware) {
        this(budget, window, proxyAware, InMemoryWriteRateLimitStore::new);
    }

    /**
     * @param stores where the counters live. The two families get separate namespaces because they
     *               must never share a counter — load-bearing for a shared backend
     */
    public WriteRateLimitFilter(int budget, Duration window, boolean proxyAware,
            WriteRateLimitStore.Factory stores) {
        this.limiter = stores.create("w", budget, window);
        // Computed as a long and clamped: at int width this wraps above 42,949,672 and would hand
        // the callbacks a *smaller* budget than everyone else.
        long callbackBudget = (long) budget * CALLBACK_BUDGET_MULTIPLIER;
        this.callbackLimiter = stores.create(
                "cb", (int) Math.min(Integer.MAX_VALUE, callbackBudget), window);
        this.window = window;
        this.proxyAware = proxyAware;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String path = path(request);

        if (isProviderCallback(request, path)) {
            long declared = request.getContentLengthLong();
            if (declared < 0 || declared > MAX_CALLBACK_BODY_BYTES) {
                // A negative length means unknown (chunked) and passes any `> cap` test, so the
                // ceiling would be bypassable by one request header.
                SecurityErrors.write(response, 413, ErrorCodes.RATE_LIMITED,
                        "Callback body must declare a length of at most "
                                + MAX_CALLBACK_BODY_BYTES + " bytes.");
                return;
            }
            if (!allow(callbackLimiter, request, response)) {
                return;
            }
            chain.doFilter(request, response);
            return;
        }

        if (!isLimited(request, path) || allow(limiter, request, response)) {
            chain.doFilter(request, response);
        }
    }

    /** Counts the request and, if over budget, writes the refusal. True means the caller proceeds. */
    private boolean allow(WriteRateLimitStore against, HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        int retryAfter = against.tryAcquire(callerKey(request), Instant.now());
        if (retryAfter == 0) {
            return true;
        }
        // Header for proxies, message for the toast a person reads. ASCII only: SecurityErrors
        // writes the body without pinning a charset, so a flourish would arrive as mojibake.
        response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter));
        SecurityErrors.write(response, 429, ErrorCodes.RATE_LIMITED,
                "Too many requests. Please slow down and try again in " + retryAfter + "s.");
        return false;
    }

    private static boolean isProviderCallback(HttpServletRequest request, String path) {
        return MUTATING.contains(request.getMethod()) && PROVIDER_CALLBACKS.contains(path);
    }

    private static boolean isLimited(HttpServletRequest request, String path) {
        if (MUTATING.contains(request.getMethod())) {
            return true;
        }
        // Not "GET": Spring MVC dispatches HEAD to @GetMapping handlers, so allowing HEAD through
        // unlimited would make the enumeration defence bypassable by a one-character change.
        return LIMITED_READS.contains(path);
    }

    /**
     * The request path in the form {@link Routes} declares it: context path removed, path parameters
     * dropped, percent escapes decoded. Each step closes a bypass — cross-cutting.md §8.5.
     */
    private static String path(HttpServletRequest request) {
        return normalisedPath(request.getContextPath(), request.getRequestURI());
    }

    /** Visible for tests, which assert the bypasses this closes without a live container. */
    static String normalisedPath(String context, String uri) {
        if (context != null && !context.isEmpty() && uri.startsWith(context)) {
            uri = uri.substring(context.length());
        }
        // Decode first, then cut, as UrlPathHelper does: cutting first leaves `%3b` intact, so
        // `/documents/shared%3Bx=1` would match nothing here yet still reach the handler.
        String decoded = UriUtils.decode(uri, StandardCharsets.UTF_8);
        int params = decoded.indexOf(';');
        return params < 0 ? decoded : decoded.substring(0, params);
    }

    /**
     * The bucket this request counts against. Prefixed by kind so a user id can never collide with
     * an address — they are different namespaces and an unprefixed key silently merges them.
     */
    private String callerKey(HttpServletRequest request) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthPrincipal principal) {
            return "u:" + principal.userId();
        }
        warnIfProxied(request);
        return "ip:" + anonymousKey(request.getRemoteAddr());
    }

    /**
     * Collapses an address to the smallest unit one party can be assumed to control: the address
     * itself for IPv4, the /64 for IPv6, which a single host is routinely assigned whole.
     */
    static String anonymousKey(String address) {
        if (address == null || address.indexOf(':') < 0 || !isNumericIpv6(address)) {
            return address == null ? "unknown" : address;
        }
        try {
            byte[] bytes = InetAddress.getByName(address).getAddress();
            if (bytes.length != 16) {
                return address;
            }
            StringBuilder prefix = new StringBuilder(23);
            for (int i = 0; i < 8; i++) {
                if (i > 0 && i % 2 == 0) {
                    prefix.append(':');
                }
                prefix.append(String.format("%02x", bytes[i]));
            }
            return prefix.append("::/64").toString();
        } catch (UnknownHostException e) {
            // Not resolvable as an address, so there is nothing to normalise; the raw string is no
            // worse a key than the address it came from.
            return address;
        }
    }

    /**
     * Whether a string is safe to hand to {@link InetAddress#getByName}, which resolves anything not
     * a literal — a non-numeric argument would mean a blocking DNS lookup on the request thread.
     */
    private static boolean isNumericIpv6(String address) {
        for (int i = 0; i < address.length(); i++) {
            char c = address.charAt(i);
            boolean allowed = c == ':' || c == '.' || c == '%'
                    || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
            if (!allowed) {
                return false;
            }
        }
        return true;
    }

    /**
     * Notices from traffic that the topology is declared wrongly — without it the failure is
     * silent. Logged once: a line per request would be an unauthenticated log-amplification tap.
     */
    private void warnIfProxied(HttpServletRequest request) {
        if (proxyAware || misconfigurationLogged || request.getHeader(FORWARDED_FOR) == null) {
            return;
        }
        misconfigurationLogged = true;
        log.error("Request carried {} but draazy.security.trusted-proxies is 'none'. Anonymous "
                + "callers are being rate limited as one bucket keyed on the proxy's address; set "
                + "that property to the proxy's address range.", FORWARDED_FOR);
    }

    /** Visible for tests and for the startup log line, which states the policy it is enforcing. */
    Duration window() {
        return window;
    }
}
