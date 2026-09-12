/**
 * Cloudflare Pages Function: proxies `/api/*` to the backend so the SPA and the API share one
 * origin.
 *
 * ### Why this is a Function and not a `_redirects` rule
 *
 * On Netlify a `/api/*  https://backend/api/:splat  200!` line in `_redirects` is a real reverse
 * proxy. On Cloudflare Pages it is not: Pages honours `_redirects` for 3xx and for rewrites that
 * stay *inside the project*, and an external target is served as a redirect rather than proxied.
 * Taking the old file at its word would produce a deploy that looks configured and is not — the
 * browser would be bounced to the backend's own origin, at which point it is cross-site with the
 * page, the `SameSite=Lax` refresh cookie is silently withheld, and every session dies fifteen
 * minutes after login. That is the exact failure `CookieDeliveryCheck` exists to refuse.
 *
 * A Function is also the only place the true client IP can be asserted — see the forwarded headers
 * below, which `_redirects` has no way to set.
 *
 * ### Routing
 *
 * `functions/api/[[path]].js` claims `/api` and everything under it. Pages resolves Functions
 * before static assets and before `_redirects`, so the SPA fallback in `public/_redirects` cannot
 * shadow this, and neither can a stray file that happens to land under `/api` in the bundle.
 *
 * The `/api` prefix is forwarded verbatim rather than stripped: the backend runs with
 * `server.servlet.context-path=/api`, so every route it serves — including
 * `/api/actuator/health` — already carries it.
 *
 * ### Configuration
 *
 * `API_ORIGIN` is a Pages environment variable (Settings → Environment variables), set per
 * environment. It is scheme + host only: no path, no trailing slash, and https because the refresh
 * cookie is a thirty-day credential that `application-prod.properties` hardcodes as `Secure`.
 */

/** Scheme + host (+ optional port). Anything else is refused rather than half-applied. */
const ORIGIN_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/;

/**
 * Requests with no body. Passing `body: request.body` for these throws in the Workers runtime, and
 * the resulting 500 would look like a backend fault rather than a proxy one.
 */
const BODYLESS = new Set(['GET', 'HEAD']);

/**
 * Client-supplied headers that any downstream hop might read as routing or identity truth, deleted
 * before the three authoritative ones are set below.
 *
 * Inert today: `TrustedProxyConfig` builds a bare `RemoteIpValve`, which reads only
 * `X-Forwarded-For`, and no `ForwardedHeaderFilter` is installed. It stops being inert the moment
 * anyone sets `server.forward-headers-strategy=framework`, because `ForwardedHeaderFilter` prefers
 * the RFC 7239 `Forwarded` header over `X-Forwarded-*` — so a client sending
 * `Forwarded: for=1.2.3.4;host=evil.com;proto=http` would silently override all three values this
 * function sets, and `X-Forwarded-Prefix` would rewrite the perceived context path. A proxy that
 * only overwrites the headers today's code happens to read is one config flag away from trusting
 * the caller, so the whole family goes.
 *
 * `CF-*` goes too, `CF-Connecting-IP` included: it is read once below and then removed, so the
 * origin has exactly one statement of client identity to reason about rather than two that could
 * disagree.
 */
const UNTRUSTED_REQUEST_HEADERS = [
    'forwarded',
    'x-real-ip',
    'true-client-ip',
    'x-client-ip',
    'x-forwarded-port',
    'x-forwarded-prefix',
    'x-forwarded-ssl',
    'x-original-url',
    'x-rewrite-url',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'cf-worker',
];

/**
 * Upstream response headers not republished under the SPA's origin.
 *
 * `Server` / `X-Powered-By` fingerprint the origin, which matters more than usual here because the
 * Cloud Run URL staying unguessable is currently load-bearing (see the `X-Forwarded-For` note
 * below). The `Access-Control-*` family is dead weight on a same-origin path, and leaving it means
 * any future widening of `WEB_ORIGINS` — a preview origin, a stray `*` — gets republished from the
 * trusted origin on credentialed responses. `Content-Encoding` / `Content-Length` are dropped
 * because the Workers runtime may have already decoded the body, which would leave the copied pair
 * describing bytes that no longer exist.
 */
const UNTRUSTED_RESPONSE_HEADERS = [
    'server',
    'x-powered-by',
    'content-encoding',
    'content-length',
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-expose-headers',
];

export async function onRequest({ request, env }) {
    const origin = (env.API_ORIGIN || '').trim().replace(/\/+$/, '');

    if (!ORIGIN_PATTERN.test(origin)) {
        // Deliberately a 502 with a JSON body rather than a fall-through. An unset API_ORIGIN that
        // let the request reach the SPA fallback would answer **200 with the HTML shell**, which
        // `http.js` treats as success: `unwrapPage` reports `{ items: [], total: 0 }`, so every
        // catalogue renders an affirmative "no results", and `getMe` stores a truthy garbage user.
        // Nothing errors anywhere, which is why this has to be loud here.
        return Response.json(
            {
                error: 'api_proxy_misconfigured',
                message:
                    'API_ORIGIN is unset or is not a bare https origin. Set it in the Pages '
                    + 'environment, e.g. https://api.draazy.com — scheme and host only.',
            },
            { status: 502 },
        );
    }

    const incoming = new URL(request.url);

    // Guaranteed by Pages routing, asserted anyway: this file is the one place a request can be
    // aimed at another origin, so the prefix it forwards is worth one line of proof.
    if (incoming.pathname !== '/api' && !incoming.pathname.startsWith('/api/')) {
        return new Response(null, { status: 404 });
    }

    // The client address, asserted by Cloudflare's edge and unforgeable from outside. Absent means
    // something other than the edge is invoking this function, and there is no safe value to
    // substitute: forwarding an empty `X-Forwarded-For` would make Tomcat adopt `""` as the remote
    // address, and `WriteRateLimitFilter` would key every anonymous caller on earth to the single
    // bucket `"ip:"` — the exact global 429 outage the trusted-proxy machinery exists to prevent,
    // arrived at silently. Fail closed instead.
    const clientIp = request.headers.get('CF-Connecting-IP');
    if (!clientIp) {
        return Response.json(
            {
                error: 'api_proxy_no_client_ip',
                message: 'CF-Connecting-IP absent; refusing to forward an unattributed request.',
            },
            { status: 502 },
        );
    }

    const target = new URL(origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    for (const header of UNTRUSTED_REQUEST_HEADERS) {
        headers.delete(header);
    }

    // Overwrite rather than append. `WriteRateLimitFilter` keys anonymous callers on the client
    // address, so a client-supplied X-Forwarded-For would let anyone choose their own rate-limit
    // bucket.
    //
    // NOTE this is only half the chain. Cloud Run's own front end appends the caller's address
    // before Tomcat sees the request, so `INTERNAL_PROXIES` must match Cloudflare's egress ranges
    // *and* Google's internal proxy range — and Cloudflare's egress addresses are shared with every
    // other Cloudflare account, so while the Cloud Run URL stays directly reachable, anyone can
    // deploy their own Worker and forge this value. Closing that needs a shared secret this
    // function sends and the origin verifies, or restricted ingress; see docs/DEPLOY.md §6.
    headers.set('X-Forwarded-For', clientIp);
    headers.set('X-Forwarded-Proto', 'https');
    // Currently a no-op — the valve is constructed without `setHostHeader`, and nothing in the
    // backend builds absolute URLs from the request. Sent anyway so the first `Location:` header or
    // password-reset link that does get built has a correct value available rather than the raw
    // `*.run.app` host.
    headers.set('X-Forwarded-Host', incoming.host);
    // `fetch` derives Host from the target URL; carrying the page's Host through would make the
    // backend answer for an origin it is not serving.
    headers.delete('Host');

    const upstream = await fetch(target, {
        method: request.method,
        headers,
        body: BODYLESS.has(request.method) ? undefined : request.body,
        // `manual` so a 3xx from the API reaches the browser intact. Following it here would
        // resolve the redirect against the *backend* origin and return its body under our own,
        // which is how an OAuth-style hop turns into an opaque 200 nobody can debug.
        redirect: 'manual',
    });

    // Cloning through the two-argument Response constructor preserves the header list as-is,
    // including multiple `Set-Cookie` entries — the refresh cookie and the readable session marker
    // are set together, and any copy that flattens headers would drop one of them. The headers on
    // the *new* Response are mutable, so the strip below is safe; rebuilding from
    // `new Headers(upstream.headers)` would not be.
    const response = new Response(upstream.body, upstream);
    for (const header of UNTRUSTED_RESPONSE_HEADERS) {
        response.headers.delete(header);
    }
    return response;
}
