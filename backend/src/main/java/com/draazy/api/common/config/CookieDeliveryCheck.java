package com.draazy.api.common.config;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Refuses to start when the browser could not deliver the refresh cookie back to this service.
 *
 * <p><strong>The failure this exists to prevent.</strong> {@code draazy_rt} is
 * {@code SameSite=Lax}, so the browser attaches it to {@code POST /auth/refresh} only when the page
 * making the call and this API are the same <em>site</em> — the same registrable domain. When they
 * are not, nothing errors: the browser silently omits the cookie, the refresh 401s, and every user
 * is signed out fifteen minutes after logging in. Server-side that is indistinguishable from a
 * visitor who simply has no session, so there is no log line to find and no alarm to raise. It also
 * cannot be caught before production, because dev and e2e run behind the Vite proxy where everything
 * is same-origin by construction. A deployment topology is therefore a load-bearing part of the auth
 * design, and the only safe place to check it is before the first request.
 *
 * <p><strong>The two topologies that work.</strong> Either the UI and the API share an origin behind
 * a path proxy ({@code draazy.com} serving the app and forwarding {@code /api} here), or they sit
 * on sibling subdomains ({@code www.draazy.com} calling {@code api.draazy.com}) — cross-origin,
 * which {@link CorsConfig}'s credentialed allow-list already handles, but still same-site, so Lax is
 * delivered. What breaks is a UI under its own registrable domain, {@code *.netlify.app} being the
 * live risk here: it is a Public Suffix List entry, so every Netlify subdomain is its own site.
 *
 * <p>The two are not equally good. The sibling-subdomain shape delivers the refresh cookie but not
 * the <em>readable</em> session hint, which is host-only by construction, so Safari's ITP recovery
 * is quietly inert there — the check warns about that rather than failing, and the reasoning is on
 * {@code warnIfSessionHintIsUnreadable}. Prefer the path proxy.
 *
 * <p><strong>Scope of the check.</strong> It compares registrable domains, not origins, because
 * cookies do not care about scheme, port, or host beyond the site. It is skipped entirely when
 * {@code draazy.web.public-origin} is unset — dev and tests, where the proxy makes the question
 * moot — and when {@code SameSite=None} has been chosen deliberately, where cross-site delivery is
 * the point. That last case logs rather than passes quietly: {@code None} buys delivery by giving up
 * the CSRF argument that justified having no CSRF token on {@code /auth/refresh}, and that debt
 * should be visible in the boot log of any environment carrying it.
 */
@Component
public class CookieDeliveryCheck {

    private static final Logger log = LoggerFactory.getLogger(CookieDeliveryCheck.class);

    /**
     * Multi-label public suffixes under which a subdomain is its own site.
     *
     * <p>Not the Public Suffix List — pulling in a PSL library to answer one boot-time question
     * would be a dependency for a question that has a short answer here. This is the set of hosting
     * suffixes a frontend for this project could plausibly land on plus the Indian second-level
     * domains, which is enough to catch the mistake anyone would actually make. Under one of these,
     * the registrable domain takes three labels rather than two, so {@code draazy.netlify.app} and
     * {@code api.netlify.app} are correctly read as different sites.
     *
     * <p>The limitation is worth naming: an exotic suffix absent from this set would be read as
     * same-site and pass. That is a check that misses a case, never one that invents a failure — a
     * false pass leaves the situation exactly as it is today, whereas a false rejection would refuse
     * to boot a correct deployment.
     */
    private static final Set<String> MULTI_LABEL_SUFFIXES = Set.of(
            "netlify.app", "vercel.app", "pages.dev", "github.io", "herokuapp.com",
            "onrender.com", "fly.dev", "azurewebsites.net", "web.app", "firebaseapp.com",
            "co.in", "net.in", "org.in", "co.uk", "com.au");

    private final String publicOrigin;
    private final List<String> allowedOrigins;
    private final String sameSite;

    CookieDeliveryCheck(
            @Value("${draazy.web.public-origin:}") String publicOrigin,
            @Value("${draazy.web.cors.allowed-origins:http://localhost:5173}") List<String> allowedOrigins,
            @Value("${draazy.security.refresh-cookie.same-site:Lax}") String sameSite) {
        this.publicOrigin = publicOrigin;
        this.allowedOrigins = allowedOrigins;
        this.sameSite = sameSite;
    }

    @PostConstruct
    void verify() {
        if (!"lax".equalsIgnoreCase(sameSite) && !"strict".equalsIgnoreCase(sameSite)) {
            log.warn("Refresh cookie is SameSite={} — cross-site delivery works, but /auth/refresh "
                    + "is then reachable by a forged cross-site POST and needs a CSRF defence of its "
                    + "own. Same-site delivery (SameSite=Lax) is the configuration this service was "
                    + "designed around.", sameSite);
            return;
        }
        if (publicOrigin.isBlank()) {
            log.info("draazy.web.public-origin is unset — skipping the refresh-cookie delivery "
                    + "check. Set it in any environment where the UI is not served through a proxy "
                    + "in front of this service.");
            return;
        }

        String apiSite = siteOf(publicOrigin);
        List<String> unreachable = new ArrayList<>();
        for (String origin : allowedOrigins) {
            if (!apiSite.equals(siteOf(origin))) {
                unreachable.add(origin);
            }
        }
        if (unreachable.isEmpty()) {
            log.info("Refresh cookie delivery verified: {} is same-site with {}", publicOrigin, allowedOrigins);
            warnIfSessionHintIsUnreadable();
            return;
        }
        throw new IllegalStateException(
                "Refresh-cookie delivery is impossible for these origins: " + unreachable
                        + ". They are cross-site with the API at " + publicOrigin + " (site '" + apiSite
                        + "'), so the browser will not attach the SameSite=Lax "
                        + "draazy_rt cookie to POST /auth/refresh and every session will die at the "
                        + "first access-token expiry — silently, with no server-side symptom. "
                        + "Serve the UI from the same registrable domain: either proxy /api through the "
                        + "UI's own host, or move the UI to a sibling subdomain of " + apiSite + ". "
                        + "Set draazy.web.public-origin to this service's browser-facing origin, and "
                        + "draazy.web.cors.allowed-origins (WEB_ORIGINS) to the UI's.");
    }

    /**
     * Warns when the topology is same-site but not same-origin, which silently disables ITP recovery.
     *
     * <p>The two cookies this service sets have different reach requirements, and only one of them is
     * checked above. {@code draazy_rt} is {@code HttpOnly}: the browser delivers it and no script
     * ever touches it, so same-<em>site</em> is the whole requirement. {@code draazy_session} is
     * the opposite — it exists to be <em>read by the UI's JavaScript</em>, which is how a Safari
     * visitor whose {@code localStorage} was wiped by Intelligent Tracking Prevention still knows to
     * attempt a refresh instead of being shown a signed-out app. {@code document.cookie} is
     * origin-scoped, and {@code __Host-} forbids the {@code Domain} attribute that would otherwise
     * widen it, so on sibling subdomains the UI cannot see the hint at all.
     *
     * <p>This is a warning rather than a boot failure because nothing is broken in the security
     * sense and nothing is broken for most visitors: sessions still refresh, and the hint only
     * matters after a browser has thrown the tokens away. The deployment degrades exactly to how it
     * behaved before the hint existed — the seven-day Safari visitor is asked to sign in again while
     * a perfectly good 30-day cookie sits unused. Refusing to start over that would be
     * disproportionate; letting the boot log say "verified" while a feature is inert would repeat
     * the very mistake this class was written to end.
     *
     * <p><strong>Do not "fix" this by setting a {@code Domain} on the hint.</strong> Dropping the
     * {@code __Host-} prefix to share the cookie across subdomains hands every host under the
     * registrable domain — including anything ever pointed at a third-party SaaS — the ability to
     * write a twin the real page may read instead. The supported repair is the path-proxy topology:
     * serve the UI and {@code /api} from one origin.
     */
    private void warnIfSessionHintIsUnreadable() {
        List<String> unreadable = new ArrayList<>();
        String apiHost = hostOf(publicOrigin);
        for (String origin : allowedOrigins) {
            if (!apiHost.equals(hostOf(origin))) {
                unreadable.add(origin);
            }
        }
        if (unreadable.isEmpty()) {
            return;
        }
        log.warn("Session-hint cookie is unreadable from these origins: {}. They are same-site with "
                + "the API at {} — so refresh works — but not same-host, and the readable "
                + "draazy_session hint is host-only (__Host- forbids a Domain attribute). Safari's "
                + "ITP clears script-written storage after seven days without interaction; without "
                + "the hint the app cannot tell that a still-valid 30-day refresh cookie is worth "
                + "trying, and those visitors are shown a signed-out app instead of being restored. "
                + "To enable the recovery, serve the UI and this API from one origin behind a path "
                + "proxy. Do NOT give the hint a Domain: that reopens cookie-shadowing from every "
                + "sibling host.", unreadable, publicOrigin);
    }

    /**
     * The host a cookie jar belongs to.
     *
     * <p>Host, not origin: {@code document.cookie} is scoped by host and path, and shared across
     * ports. Comparing full origins would warn about a correctly proxied deployment that merely
     * spells its port differently, and a warning that fires on a healthy configuration is a warning
     * nobody reads. Scheme is likewise not compared — in any deployment where this check runs at all
     * both sides are HTTPS, and if they were not, the {@code Secure} attribute would be the least of
     * the problems.
     */
    private static String hostOf(String origin) {
        String raw = origin.trim().toLowerCase(Locale.ROOT);
        try {
            URI uri = URI.create(raw);
            return uri.getHost() != null ? uri.getHost() : raw;
        } catch (IllegalArgumentException e) {
            return raw;
        }
    }

    /**
     * The registrable domain of an origin — what a cookie means by "site".
     *
     * <p>An unparseable value or a bare host falls back to the input, which makes the comparison
     * strict rather than lenient: two values that cannot be understood have to match exactly to pass.
     */
    private static String siteOf(String origin) {
        String host;
        try {
            URI uri = URI.create(origin.trim());
            host = uri.getHost() != null ? uri.getHost() : origin.trim();
        } catch (IllegalArgumentException e) {
            host = origin.trim();
        }
        host = host.toLowerCase(Locale.ROOT);

        String[] labels = host.split("\\.");
        if (labels.length < 3) {
            // "localhost", an IP literal, or an already-registrable "draazy.com".
            return host;
        }
        String lastTwo = labels[labels.length - 2] + "." + labels[labels.length - 1];
        if (MULTI_LABEL_SUFFIXES.contains(lastTwo)) {
            return labels[labels.length - 3] + "." + lastTwo;
        }
        return lastTwo;
    }
}
