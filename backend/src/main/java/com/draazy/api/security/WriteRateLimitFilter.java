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
 * Caps how many mutating requests one caller may make in a window (tech-debt D2).
 *
 * <p><strong>The gap this closes.</strong> Only {@code POST /auth/login} was limited. Every
 * authenticated write added since — enquiries, offers, visits, reviews, saved searches, service
 * requests — was free to a script holding one valid token, and several of them cost real money or
 * send a real notification to a real person. The right shape was never a per-controller annotation:
 * a rule that must be remembered at every new endpoint is a rule that will eventually be forgotten
 * at one, and the endpoint it is forgotten at is the one that matters. So this is a filter, and it
 * applies to writes by default rather than by opt-in.
 *
 * <p><strong>Where it sits and why.</strong> After {@link JwtAuthFilter}, so the principal is
 * resolved and the counter can key on a user id rather than an address — otherwise every caller
 * behind one corporate NAT or mobile carrier gateway would share a budget. Before authorisation, so
 * the cost of refusing is a map lookup rather than a database round trip: a limiter that first does
 * the work it is trying to prevent is not a limiter.
 *
 * <p><strong>Reads are untouched, deliberately.</strong> A GET is cheap, cacheable, idempotent and
 * often anonymous; limiting it here would mean guessing a budget for a public catalogue browsed by
 * people we want browsing it. The page-size ceiling
 * ({@code spring.data.web.pageable.max-page-size}) is what bounds read amplification. Two reads the
 * register calls out separately: {@code GET /documents/shared}, which is anonymous and
 * token-guessable, so its risk is brute force rather than volume; and {@code GET /me/data-export},
 * which is the one read on the platform that is neither cheap nor cacheable. Both are included
 * below by path.
 *
 * <p><strong>Anonymous writes fall back to the client address</strong>, which is weaker than a
 * principal but is all there is before someone has logged in. That depends entirely on
 * {@code getRemoteAddr()} actually being the client's address: behind a load balancer it is the
 * balancer's, so every anonymous caller on the internet shares one bucket and a single host can 429
 * the whole platform — the limiter becoming the outage. {@link TrustedProxyConfig} makes the
 * topology an explicit, validated declaration rather than something inferred from a profile name,
 * and this filter logs loudly the first time a request arrives carrying {@code X-Forwarded-For}
 * while that declaration says nothing is in front. The header is never read here directly: doing so
 * would let every caller choose their own bucket, which is worse than a coarse one.
 *
 * <p>An IPv6 address is collapsed to its /64 before keying, because a single host is routinely
 * assigned an entire /64 and would otherwise have 2⁶⁴ free budgets. The anonymous write surface is
 * small and its entries mostly carry their own DB-backed limit keyed on a mobile number
 * ({@code POST /society-leads}, {@code POST /auth/login}), so this is a second line rather than the
 * only one.
 *
 * <p><strong>The budget is not a performance figure.</strong> It is set far above what a person
 * does — a determined user filling forms produces single-digit writes a minute — and far below what
 * a script wants. Nothing legitimate should ever see a 429 from here, which is the test of whether
 * the number is right.
 */
public class WriteRateLimitFilter extends OncePerRequestFilter {

    private static final Set<String> MUTATING = Set.of("POST", "PUT", "PATCH", "DELETE");

    /**
     * Reads that are limited anyway, matched on the normalised path {@link #path} produces.
     *
     * <p>{@code GET /documents/shared} is anonymous and authenticated solely by an unguessable token
     * in the query string, so the attack against it is enumeration — many requests, each cheap and
     * each individually valid-looking. That is precisely the shape a rate limit answers and an
     * authorisation rule cannot.
     *
     * <p>{@code GET /me/data-export} is here for the opposite reason: not because each request is
     * cheap, but because none of them are. It runs roughly seventy queries across the whole schema
     * and assembles the result in memory, making it by a wide margin the most expensive read the
     * platform serves, and unlike every other read it cannot be cached — an access-request document
     * is a point-in-time statement and a stale one would be a false statement. It is also
     * authenticated, so the general argument for leaving reads alone (a public catalogue browsed by
     * people we want browsing it) simply does not apply: the caller is a known account with a
     * per-principal bucket, and no human exercises their statutory right of access a hundred and
     * twenty times a minute. The per-dataset row cap in {@code DataExportService} bounds what one
     * request costs; this bounds how many of them arrive.
     *
     * <p>Both are matched on path alone, not on method, for the reason in {@link #isLimited}.
     *
     * <p>The export path is a literal rather than a reference to {@code
     * DataExportController.ME_DATA_EXPORT}, because this package deliberately imports nothing from a
     * feature package and inverting that for one constant would be a poor trade. The cost is that a
     * rename here fails open and silently, so {@code WriteRateLimitTest.dataExportIsLimited} drives
     * a real request for that path through this filter and asserts it is refused — closing the gap
     * behaviourally where it cannot be closed structurally.
     */
    private static final Set<String> LIMITED_READS = Set.of(
            Routes.Documents.SHARED,
            "/me/data-export");

    /**
     * Provider callbacks, which get their own budget rather than an exemption.
     *
     * <p>They cannot share the ordinary one: they are server-to-server, so they all arrive from a
     * handful of provider addresses that would land in a single bucket, and a refused callback is a
     * customer who paid and was not credited. But a blanket exemption made these the only completely
     * unthrottled writes on the platform — and they are {@code permitAll}, so an attacker can send
     * them too. The HMAC rejects an unsigned body, yet only after the container has buffered that
     * body and the handler has materialised it as a string; the cost is paid before the check. So
     * they are limited, at a budget far above any plausible retry storm and far below a flood.
     */
    private static final Set<String> PROVIDER_CALLBACKS =
            Set.of(Routes.Webhooks.CASHFREE_DIGILOCKER, Routes.Webhooks.CASHFREE_PAYMENT);

    /**
     * How much more of the window a provider callback may use than an ordinary caller.
     *
     * <p>Sized for the worst legitimate case — a provider replaying a backlog after an outage, all
     * of it from one address — while still bounding an anonymous flood to something the heap
     * survives.
     */
    private static final int CALLBACK_BUDGET_MULTIPLIER = 50;

    /**
     * Ceiling on a provider callback body, in bytes.
     *
     * <p>Nothing else bounds it: Tomcat's {@code maxPostSize} covers only form encoding and
     * {@code spring.servlet.multipart} only multipart, so a {@code application/json} body has no
     * limit anywhere in this stack. The handler takes the raw body as a {@code String} because the
     * signature is over exact bytes, which means a few hundred megabytes of unsigned JSON is
     * materialised on the heap — roughly three times over — before the HMAC is ever consulted. A
     * real Cashfree callback is a couple of kilobytes.
     *
     * <p>{@code 64L} rather than {@code 64}: the arithmetic happens in the type of its operands, so
     * an {@code int} expression is evaluated as {@code int} and only then widened to this
     * {@code long}. It is correct at 64 KiB, and it stops being correct the moment someone raises
     * the ceiling past 2 GiB — at which point it overflows silently to a negative number and the
     * bound inverts, admitting exactly the unbounded body this field exists to refuse. Anchoring
     * the literal keeps the whole expression in {@code long}.
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
     * @param stores where the counters live (tech-debt D158). The two families get separate
     *               namespaces because they must never share a counter — obvious for a per-instance
     *               map, which is two objects, and load-bearing for a shared backend, where one
     *               namespace would add every instance's callbacks to every instance's users
     */
    public WriteRateLimitFilter(int budget, Duration window, boolean proxyAware,
            WriteRateLimitStore.Factory stores) {
        this.limiter = stores.create("w", budget, window);
        // Computed as a long and clamped: at int width this multiplication wraps above 42,949,672
        // and would hand the callbacks a *smaller* budget than everyone else, quietly, from a
        // configuration value that is merely absurd rather than obviously invalid.
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
                // A negative length means the length is unknown, which in practice means
                // `Transfer-Encoding: chunked` — and an unknown length passes any `> cap` test, so
                // treating it as acceptable would leave the ceiling below trivially bypassable by
                // one request header. Refusing it costs nothing: the provider always declares a
                // length, and a caller that will not say how much it is about to send is not one to
                // buffer on faith. Beyond this point the declared length is also the enforced one,
                // because the container stops reading a non-chunked body at it.
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

    /**
     * Counts the request and, if it is over budget, writes the refusal.
     *
     * @return {@code true} if the caller may proceed
     */
    private boolean allow(WriteRateLimitStore against, HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        int retryAfter = against.tryAcquire(callerKey(request), Instant.now());
        if (retryAfter == 0) {
            return true;
        }
        // Retry-After is set as well as carried in the message: the header is what a well-behaved
        // client and every HTTP proxy understand, the message is what a person reads in a toast.
        response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter));
        // ASCII only: SecurityErrors hand-writes the body through the response writer without
        // pinning a charset, so a punctuation flourish here would reach the client as mojibake.
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
        // Not "GET": Spring MVC dispatches HEAD to @GetMapping handlers and merely suppresses the
        // body, so the handler runs in full and the status code is a perfectly good oracle. Against
        // an endpoint whose whole risk is token enumeration, allowing HEAD through unlimited would
        // have made the control bypassable by a one-character change to the method.
        return LIMITED_READS.contains(path);
    }

    /**
     * The request path in the same form {@link Routes} declares it: context path removed, path
     * parameters dropped, percent escapes decoded.
     *
     * <p><strong>Each step closes a specific bypass.</strong> {@code getRequestURI()} is raw, but the
     * dispatcher routes on the decoded path — so a matcher comparing the raw value sees
     * {@code /documents/share%64} as an unknown path while Spring cheerfully routes it to
     * {@code /documents/shared}. Likewise Spring's path matching excludes {@code ;name=value} path
     * parameters, so {@code /documents/shared;x=1} reaches the same handler while a naive comparison
     * misses it. Spring Security's default {@code StrictHttpFirewall} happens to reject both of those
     * shapes today, which is a good reason to expect this code to be exercised rarely and no reason
     * at all to depend on it: relaxing the firewall to support matrix parameters would otherwise
     * silently reopen the enumeration defence on a token-guessable endpoint.
     *
     * <p>Derived here rather than taken from {@code getServletPath()} because the two agree in a real
     * container and not under MockMvc, and a helper that behaves one way in the tests and another in
     * production would leave every rule above unproven.
     */
    private static String path(HttpServletRequest request) {
        return normalisedPath(request.getContextPath(), request.getRequestURI());
    }

    /** Visible for tests, which assert the bypasses this closes without a live container. */
    static String normalisedPath(String context, String uri) {
        if (context != null && !context.isEmpty() && uri.startsWith(context)) {
            uri = uri.substring(context.length());
        }
        // Decode first, then cut: that is the order Spring's UrlPathHelper uses, and the order is
        // itself a bypass. Cutting first leaves `%3b` intact, so `/documents/shared%3Bx=1` would
        // normalise to something that matches nothing here while the dispatcher still routes it to
        // the protected handler — reopening both the enumeration limit and the callback body cap.
        String decoded = UriUtils.decode(uri, StandardCharsets.UTF_8);
        int params = decoded.indexOf(';');
        return params < 0 ? decoded : decoded.substring(0, params);
    }

    /**
     * The bucket this request counts against.
     *
     * <p>Prefixed by kind so a user id can never collide with an address — they are different
     * namespaces and an unprefixed key silently merges them.
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
     * Collapses an address to the smallest unit one party can be assumed to control.
     *
     * <p>For IPv4 that is the address itself. For IPv6 it is the /64: a single host is routinely
     * assigned an entire /64 and can source from any of its 2⁶⁴ addresses at no cost, so keying on
     * the full address would hand that host an unlimited number of fresh budgets and make the limit
     * meaningless exactly where it is easiest to defeat. It also makes the tracked-key ceiling mean
     * something: 2⁶⁴ possible keys cannot be bounded by any cap, a /64 count can.
     *
     * <p>The cost is that genuinely distinct users behind one /64 share a bucket, which is the same
     * trade already accepted for IPv4 addresses behind a carrier NAT, and is why the budget is set
     * far above human use.
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
            // Not resolvable as an address, so it is not something this can normalise. Keying on the
            // raw string is no worse than the address it came from.
            return address;
        }
    }

    /**
     * Whether a string is safe to hand to {@link InetAddress#getByName}.
     *
     * <p>{@code getByName} resolves anything that is not a literal, so a non-numeric argument turns
     * a key derivation into a blocking DNS lookup on the request thread. Nothing can currently
     * deliver one — Tomcat's peer address and {@code RemoteIpValve}'s output are both validated
     * literals — but that invariant lives two layers away, and this is one character class.
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
     * Notices, from traffic, that the deployment topology has been declared wrongly.
     *
     * <p>{@code draazy.security.trusted-proxies=none} says nothing sits in front of this instance.
     * A request that arrives carrying {@code X-Forwarded-For} is evidence that something does — and
     * that every anonymous caller is therefore being keyed on that proxy's address, one shared bucket
     * for the whole internet. That is the failure this whole arrangement exists to prevent, and
     * without this check it is completely silent: startup is green, every endpoint works, and the
     * limit is simply wrong.
     *
     * <p>Logged once. The condition is a deployment fact rather than a per-request event, and a line
     * per request would be an unauthenticated log-amplification tap.
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
