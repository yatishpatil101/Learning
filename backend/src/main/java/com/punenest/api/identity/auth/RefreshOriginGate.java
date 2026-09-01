package com.punenest.api.identity.auth;

import com.punenest.api.common.config.CorsConfig;
import com.punenest.api.common.error.ForbiddenException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;

/**
 * Decides whether a request is allowed to <em>rotate</em> the refresh token, as opposed to merely
 * carrying it.
 *
 * <p><strong>The gap this closes.</strong> {@code SameSite=Lax} is the whole CSRF argument for
 * {@code POST /auth/refresh} (see {@link com.punenest.api.security.SecurityConfig}), and it is a
 * sound one — but it is a statement about <em>sites</em>, not origins. Every host under the
 * registrable domain is the same site. So in the sibling-subdomain topology that
 * {@link com.punenest.api.common.config.CookieDeliveryCheck} blesses — a frontend on
 * {@code www.punenest.in} talking to an API on {@code api.punenest.in}, which is the only shape in
 * which {@code Lax} delivers the cookie at all — any page on any <em>other</em> subdomain is also
 * same-site. A marketing microsite, a status page hosted for us by a third party, a subdomain whose
 * DNS record outlived the service it pointed at and can now be claimed by someone else: each of
 * them can run
 *
 * <pre>{@code fetch('https://api.punenest.in/api/auth/refresh', { credentials: 'include' })}</pre>
 *
 * <p>and the browser will attach the refresh cookie, because that request is same-site and Lax is
 * satisfied. CORS then stops the attacker <em>reading</em> the rotated pair, which is why this looks
 * harmless at first — but CORS censors the response, it does not cancel the request. The rotation
 * has already happened by the time the browser discards the answer: the victim's cookie is now a
 * spent token, the fresh one went nowhere, and their next refresh — fifteen minutes later, well
 * outside the grace window — presents a revoked token and trips reuse-detection, which revokes their
 * entire family. One visit to the attacker's page signs the victim out of every device, and it does
 * it through the machinery built to protect them. Repeat it and they cannot stay signed in at all.
 *
 * <p><strong>What the gate tests, and why in that order.</strong>
 *
 * <ul>
 *   <li>{@code Sec-Fetch-Site: same-origin} — allowed. The browser is asserting the request came
 *       from a page on this exact origin, and no sibling host can produce that value. This is the
 *       case for every same-origin deployment: the Vite dev proxy, and any production topology that
 *       puts the API behind the frontend's own domain at {@code /api}.</li>
 *   <li>{@code Sec-Fetch-Site} absent — allowed, and this is deliberate rather than an oversight.
 *       The header is sent by every browser current enough to be a threat here; its absence means a
 *       non-browser caller (curl, a contract test, a future mobile client), and a non-browser caller
 *       has no ambient cookie jar to be abused through. Refusing instead would break every such
 *       caller in exchange for closing nothing, because the attack requires a browser to supply the
 *       victim's cookie. Same reasoning as {@code AuthController.clearHint}'s gate, which is
 *       deliberate symmetry: two different rules about the same header on the same endpoint would be
 *       two things to get right.</li>
 *   <li>{@code none} — allowed. A user-initiated navigation, which cannot be a POST with a body from
 *       someone else's page.</li>
 *   <li>Anything else ({@code same-site}, {@code cross-site}) — allowed only if the {@code Origin}
 *       header names an origin we serve. That clause is what keeps the sibling-subdomain topology
 *       working: there the legitimate frontend genuinely is {@code same-site}, and the only thing
 *       separating it from the attacker is which origin it is. {@code cross-site} arrives with no
 *       cookie anyway, so refusing it changes no outcome — but it does mean the refusal happens
 *       before anything is read or written, which matters more than it sounds (below).</li>
 * </ul>
 *
 * <p><strong>Why this runs before everything else in the handler.</strong> A refusal must not touch
 * the jar. Rotating is the damage, so obviously that must not happen — but neither must the hint
 * clear that rides on a 401, or the attacker gains the very write primitive
 * {@code AuthController.clearHint} exists to deny them. Failing here as a 403 before the cookie is
 * even read gives the request no side effect at all.
 *
 * <p><strong>403 rather than a 401.</strong> The attacker cannot read either one, so this is not
 * about them; it is about us. A 401 from this endpoint is ordinary — expired sessions produce a
 * steady background of them — and burying a subdomain takeover in that noise would waste the one
 * signal we get. A 403 here is never routine, and the log line names the offending origin so the
 * page can be found. The origin is safe to log; the cookie would not be, and is not touched.
 *
 * <p><strong>Matching is exact, on purpose.</strong> No trailing-slash forgiveness, no case folding
 * — because {@link CorsConfig} does not forgive them either. A configured origin with a stray slash
 * is already broken for CORS; making it work here would produce a deployment where the gate and the
 * browser disagree about who our frontend is, and the resulting half-working state is far harder to
 * read than the one symptom a strict match gives.
 */
@Component
public class RefreshOriginGate {

    private static final Logger log = LoggerFactory.getLogger(RefreshOriginGate.class);

    private static final String FETCH_SITE = "Sec-Fetch-Site";
    private static final String SAME_ORIGIN = "same-origin";
    private static final String USER_INITIATED = "none";

    private final Set<String> allowedOrigins;

    RefreshOriginGate(@Value(CorsConfig.ALLOWED_ORIGINS) List<String> allowedOrigins) {
        this.allowedOrigins = Set.copyOf(allowedOrigins);
    }

    /**
     * Throws {@link ForbiddenException} if this request may not rotate a refresh token; returns
     * quietly otherwise.
     *
     * @throws ForbiddenException when the request is same-site or cross-site and its {@code Origin}
     *                            is not one we serve
     */
    public void check(HttpServletRequest request) {
        String site = request.getHeader(FETCH_SITE);
        if (site == null || SAME_ORIGIN.equals(site) || USER_INITIATED.equals(site)) {
            return;
        }
        String origin = request.getHeader(HttpHeaders.ORIGIN);
        if (origin != null && allowedOrigins.contains(origin)) {
            return;
        }
        // Worth an operator's attention every time. The benign readings are a frontend origin that
        // was deployed without being added to the allow-list — in which case every user of that
        // origin is stuck at fifteen minutes and this is the only place that says why — and a
        // stray cross-site probe. The reading that matters is a page on our own registrable domain
        // that we did not put there.
        log.warn("Refusing to rotate a refresh token for a {} request from origin {}: not an origin "
                + "this API serves. Either an allowed origin is missing from {}, or a page under our "
                + "own registrable domain is driving refreshes it should not be able to drive.",
                site, origin == null ? "<absent>" : origin, "punenest.web.cors.allowed-origins");
        throw new ForbiddenException("Refresh is not permitted from this origin");
    }
}
