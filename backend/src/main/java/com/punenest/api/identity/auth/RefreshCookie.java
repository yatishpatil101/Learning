package com.punenest.api.identity.auth;

import com.punenest.api.security.JwtProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * Builds the {@code Set-Cookie} that carries the refresh token, and the one that clears it.
 *
 * <p><strong>Why the refresh token is a cookie and the access token is not.</strong> The access
 * token is short-lived (15 min) and every request needs it in a header, so the client has to be able
 * to read it; it stays in web storage. The refresh token is the long-lived half — spend it and you
 * get a fresh session for the rest of its 30-day TTL — and the client never needs to *read* it, only
 * to *send* it, to exactly one endpoint. Anything a client never reads should be {@code HttpOnly}:
 * that is the whole attack-surface reduction here.
 *
 * <p><strong>Be precise about what this buys, because it is easy to overclaim.</strong>
 * {@code HttpOnly} stops script *reading* the token, not *using* it. An XSS on our own origin can
 * still call {@code POST /auth/refresh} with {@code credentials: 'include'}; the browser attaches
 * the cookie, and the response — being same-origin — is fully readable, so the payload can mint
 * fresh access tokens for as long as the page lives and can keep the chain warm by rotating it.
 * What the cookie genuinely prevents is <em>exfiltration</em>: the attacker cannot post the refresh
 * token to a server of their own and hold a month of offline, out-of-band re-authentication after
 * the tab is gone. That is a real and worthwhile reduction — it converts a persistent stolen
 * credential into a capability that dies with the compromised page — but it is not immunity, and
 * the residual exposure is the refresh TTL from within the page, not fifteen minutes.
 * The corollary is that XSS is now the dominant risk to this credential, which is what makes
 * dropping {@code 'unsafe-inline'} from the frontend's {@code script-src} the mitigation that
 * actually matters.
 *
 * <p><strong>Attributes, and why each one.</strong>
 * <ul>
 *   <li>{@code HttpOnly} — the point of the exercise: no {@code document.cookie} access.</li>
 *   <li>{@code Secure} — a refresh token on the wire in clear is the same token. Configurable only
 *       so {@code http://localhost} development works at all; production must leave it on, and
 *       {@code application-prod.properties} does not override it.</li>
 *   <li>{@code SameSite} — {@code Lax} by default. With the frontend and API on one <em>site</em>
 *       the cookie never needs to ride a cross-site request. Lax withholds it from cross-site POSTs,
 *       which is what makes CSRF against {@code /auth/refresh} a non-event and is why this change
 *       adds no CSRF token: a forged cross-site POST arrives with no cookie, and even if it did,
 *       CORS stops the attacker reading the rotated pair out of the response.
 *       <p><b>This is a deployment invariant, not merely a description.</b> It fails <em>silently
 *       and totally</em> if it does not hold: a cross-site {@code fetch} simply omits a Lax cookie,
 *       so {@code POST /auth/refresh} arrives with nothing, 401s, and every user is signed out
 *       fifteen minutes after logging in — with a log indistinguishable from a genuinely absent
 *       session. Dev and e2e cannot catch it, because the Vite proxy makes everything same-origin
 *       there. Two topologies satisfy it: same-origin behind a path proxy
 *       ({@code punenest.com} serving the UI and proxying {@code /api} to this service), or sibling
 *       subdomains ({@code www.punenest.com} → {@code api.punenest.com}), which is cross-origin but
 *       still same-site, so Lax is delivered and {@code CorsConfig}'s credentialed allow-list covers
 *       the rest. What breaks it is a frontend under its own registrable domain — notably
 *       {@code *.netlify.app}, a Public Suffix List entry, which makes every Netlify subdomain its
 *       own site.
 *       <p>Because that failure is invisible at runtime, {@link
 *       com.punenest.api.common.config.CookieDeliveryCheck} refuses to start the application when
 *       the configured origins could not receive this cookie. Overriding to {@code SameSite=None}
 *       is possible but is <em>not</em> a free repair: it deletes the CSRF argument above, so
 *       {@code /auth/refresh} would then need a double-submit token or an Origin allow-list, and the
 *       check logs that debt rather than silently blessing it.</li>
 *   <li>No {@code Domain} — a host-only cookie, and the {@code __Host-} prefix below makes that
 *       binding one the browser enforces rather than one we merely intend.</li>
 *   <li>{@code Path=/} — mandated by {@code __Host-}. This is a deliberate reversal: the cookie used
 *       to be scoped to {@code /api/auth} so that no handler outside the auth family was ever sent
 *       it. That scoping only ever defended against <em>our own</em> misrouting — a logging proxy or
 *       a careless handler elsewhere in this API — and nothing in this service logs cookies or
 *       request headers. The prefix defends against an <em>attacker</em>, which is the strictly
 *       larger threat, and the two cannot both be had. See the prefix note below for what is being
 *       bought.</li>
 * </ul>
 *
 * <p><strong>The {@code __Host-} prefix, and the attack it closes.</strong> {@code SameSite},
 * {@code Secure} and {@code HttpOnly} all constrain what a <em>page</em> may do with a cookie.
 * None of them constrain what a <em>sibling host</em> may put in the jar. Any host under the
 * registrable domain — a marketing site, a status page on third-party SaaS, an abandoned DNS record
 * someone else can claim — can send {@code Set-Cookie: punenest_rt=…; Domain=.punenest.in}, and
 * because a domain cookie and a host-only cookie of the same name are two distinct entries, neither
 * our clear nor the client's can remove it. The consequences compose into session fixation:
 * plant a refresh token for an account <em>you</em> control, plant a hint beside it, and the
 * victim's next cold boot silently signs them into your account, where everything they then type is
 * yours to read. The sibling-subdomain topology {@link
 * com.punenest.api.common.config.CookieDeliveryCheck} blesses is exactly the shape where such
 * siblings exist.
 *
 * <p>Browsers reject any {@code Set-Cookie} whose name begins {@code __Host-} unless it is
 * {@code Secure}, has no {@code Domain}, and is {@code Path=/} — so the prefix converts "we did not
 * set a Domain" into "no one can". It requires {@code Secure}, so it is applied only when
 * {@code secure} is on; plain-http development keeps the bare name, and the two shapes are covered
 * by their own tests rather than left to whichever profile the suite happens to load.
 *
 * <p><strong>Lifetime follows "remember this device".</strong> A remembered session gets a
 * persistent cookie capped at the refresh TTL; an unremembered one gets a session cookie that the
 * browser drops on close. Without that distinction the checkbox would be a lie: the access token
 * lives in {@code sessionStorage} and dies with the tab, so the app would *look* signed out while a
 * 30-day credential sat in the jar waiting for anyone who could reach {@code POST /auth/refresh}
 * from this origin.
 */
@Component
public class RefreshCookie {

    private static final Logger log = LoggerFactory.getLogger(RefreshCookie.class);

    /**
     * Browser-enforced cookie-name prefix. Applied whenever the cookie is {@code Secure}, which is
     * everywhere but plain-http local development.
     */
    private static final String HOST_PREFIX = "__Host-";

    /**
     * Base cookie name. Prefixed rather than bare {@code refresh_token} to avoid colliding on the
     * origin. The name actually sent is {@link #name()} — this constant is the unprefixed half and
     * must not be used to read a cookie off a live request.
     */
    public static final String NAME = "punenest_rt";

    /**
     * Companion cookie that says only <em>that</em> a session exists — never whose, never any part
     * of the token. Deliberately <b>not</b> {@code HttpOnly}, which is the entire point of it.
     *
     * <p><strong>Why a second cookie exists at all.</strong> Safari's Intelligent Tracking
     * Prevention caps <em>script-writable</em> storage — {@code localStorage}, IndexedDB, and
     * cookies written through {@code document.cookie} — at seven days without first-party
     * interaction. Cookies delivered by a {@code Set-Cookie} response header are not capped, so
     * after a week a remembered Safari user has lost their cached profile and access token while
     * {@link #NAME} sits in the jar valid for another twenty-three days. Nothing would ever spend
     * it: the client's 401-recovery path treats a missing access token as "signed out" and never
     * refreshes, so "remember this device for 30 days" quietly meant seven — and the surviving
     * cookie was unreachable rather than merely unused.
     *
     * <p>From web storage alone a cold boot cannot tell <em>signed out</em> from <em>storage was
     * cleared underneath a live session</em>; both are an empty {@code localStorage}. This cookie is
     * the missing bit: server-set so ITP spares it, readable so the boot path can branch on it, and
     * worthless if stolen so making it readable costs nothing. An XSS that reads it learns a session
     * exists — which it could already establish by calling {@code /auth/refresh} and seeing a 200 —
     * so this discloses nothing {@code HttpOnly} was protecting.
     *
     * <p>{@code Path=/} because {@code document.cookie} only returns cookies matching the current
     * path, and the boot check runs on whatever page the visitor happened to land on. Every other
     * attribute mirrors the refresh cookie so the two expire together: a hint that outlived its
     * token would send the client into a refresh that can only 401.
     */
    public static final String HINT_NAME = "punenest_session";

    /**
     * The hint's value when the user asked to be remembered; {@link #HINT_SESSION} otherwise.
     *
     * <p>Carries no identity — it answers "is there a session, and was it meant to outlive the
     * browser" and nothing else, because anything richer would be a disclosure with no
     * corresponding use. The second bit is not decoration. The browser tells the server nothing
     * about the lifetime of the cookie it presents, so {@code /auth/refresh} has to be told
     * {@code remember} on every rotation, and the client used to derive it from which storage tier
     * held the tokens. That derivation is exactly what ITP destroys: after the wipe both tiers are
     * empty, the client would answer "not remembered", and the very refresh that rescued the
     * session would demote its 30-day cookie to a session one. The recovery would consume the
     * promise it exists to keep. Since this cookie is the only thing that survived, it is the only
     * thing that can carry the answer.
     */
    private static final String HINT_REMEMBERED = "1";

    /** The hint's value for a session the user declined to have remembered. */
    private static final String HINT_SESSION = "0";

    /** {@code ResponseCookie}'s own sentinel for "omit Max-Age" — i.e. a session cookie. */
    private static final Duration SESSION_ONLY = Duration.ofSeconds(-1);

    private final Duration ttl;
    private final boolean secure;
    private final String sameSite;

    RefreshCookie(JwtProperties jwt,
            @Value("${punenest.security.refresh-cookie.secure:true}") boolean secure,
            @Value("${punenest.security.refresh-cookie.same-site:Lax}") String sameSite) {
        this.ttl = jwt.refreshTtl();
        this.secure = secure;
        this.sameSite = sameSite;
    }

    /** The refresh cookie's name on this deployment — {@code __Host-} prefixed wherever it is Secure. */
    public String name() {
        return secure ? HOST_PREFIX + NAME : NAME;
    }

    /** The hint cookie's name on this deployment. Prefixed on the same condition, for the same reason. */
    public String hintName() {
        return secure ? HOST_PREFIX + HINT_NAME : HINT_NAME;
    }

    /**
     * The refresh token the browser presented, or {@code null} if it presented none — or more than
     * one.
     *
     * <p>Read off the request rather than bound with {@code @CookieValue} because the name is
     * decided at runtime, and because the annotation silently hands back the <em>first</em> match
     * and hides the rest. Duplicates are not a quirk to tolerate: two cookies of one name are two
     * cookies from two different scopes, which is the signature of another host writing into our
     * jar. Which one {@code @CookieValue} would have picked is creation-ordered and unspecifiable,
     * so honouring either is a coin flip on whose session the caller gets. Refusing both costs a
     * legitimate user one sign-in and costs the attack everything.
     *
     * <p>Belt and braces next to {@link #name()}'s prefix, which should make the duplicate
     * unwritable in the first place — but only on a {@code Secure} deployment, and only for browsers
     * that enforce it, and the leftovers of a pre-prefix rollout live in real jars for thirty days.
     *
     * <p>The duplicate case is logged because it is otherwise indistinguishable, from every side, of
     * an ordinary expiry: the user sees a sign-in screen, the client sees the 401 it always sees,
     * and the response body is the same. That is the right behaviour and the wrong amount of
     * evidence — a scope-confusion attempt and a leftover cookie from a rollout produce identical
     * symptoms, and only one of them is worth waking up for. The name is logged and the value never
     * is: the value is a live credential, and a refresh token in an aggregated log outlives the
     * request by a month.
     */
    public String presented(HttpServletRequest request) {
        Cookie[] jar = request.getCookies();
        if (jar == null) {
            return null;
        }
        String wanted = name();
        String found = null;
        for (Cookie c : jar) {
            if (wanted.equals(c.getName())) {
                if (found != null) {
                    log.warn("Refusing a refresh: the request carried more than one '{}' cookie, "
                            + "which means two scopes. Expect either a leftover from a cookie-name "
                            + "or path change, or another host writing into our jar.", wanted);
                    return null;
                }
                found = c.getValue();
            }
        }
        return found == null || found.isBlank() ? null : found;
    }

    /** The cookie for a freshly issued or rotated token. */
    public ResponseCookie issued(String rawToken, boolean remember) {
        return base(rawToken).maxAge(remember ? ttl : SESSION_ONLY).build();
    }

    /**
     * The readable companion to {@link #issued}, with the same lifetime so the pair cannot drift.
     *
     * <p>An unremembered session gets a session-scoped hint too, which is what keeps the checkbox
     * honest in the other direction: were the hint persistent, a browser restart would leave a
     * marker claiming a session whose cookie the browser had already dropped, and every cold boot
     * would spend a doomed refresh to discover it.
     */
    public ResponseCookie issuedHint(boolean remember) {
        return hintBase(remember ? HINT_REMEMBERED : HINT_SESSION)
                .maxAge(remember ? ttl : SESSION_ONLY)
                .build();
    }

    /**
     * The cookie that removes the stored one. Same name/path/attributes with an empty value and
     * {@code Max-Age=0} — a browser only replaces a cookie when the triple matches, so a "clear"
     * built with different attributes leaves the original sitting there.
     */
    public ResponseCookie cleared() {
        return base("").maxAge(Duration.ZERO).build();
    }

    /**
     * Clears the hint. Must accompany every {@link #cleared()}: a hint left behind after logout
     * sends the next cold boot into a refresh that can only 401, turning a clean sign-out into a
     * request shaped exactly like reuse-detection tripping.
     */
    public ResponseCookie clearedHint() {
        return hintBase("").maxAge(Duration.ZERO).build();
    }

    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(name(), value)
                .httpOnly(true)
                .secure(secure)
                .sameSite(sameSite)
                .path("/");
    }

    private ResponseCookie.ResponseCookieBuilder hintBase(String value) {
        return ResponseCookie.from(hintName(), value)
                .httpOnly(false)
                .secure(secure)
                .sameSite(sameSite)
                .path("/");
    }
}
