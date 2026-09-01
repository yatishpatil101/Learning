package com.punenest.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.common.error.ForbiddenException;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * Which origins may rotate a refresh token.
 *
 * <p>The behaviour under test is the only thing standing between the sibling-subdomain topology and
 * a one-click forced sign-out of every user who visits a page under our own registrable domain
 * ({@link RefreshOriginGate} explains the mechanism). It is also, awkwardly, invisible to the rest of
 * the suite: {@code MockMvc} sends neither {@code Sec-Fetch-Site} nor {@code Origin}, so
 * {@code AuthEndpointsTest} exercises the fail-open branch and nothing else, and a regression that
 * inverted the decision — or deleted it — would leave the whole suite green. Hence a dedicated test
 * that supplies the headers a browser would.
 *
 * <p>Plain constructor call rather than a context, for the same reason as
 * {@code RefreshCookieNamingTest}: the decision is a pure function of two headers and a configured
 * list, and booting Spring to ask would be slower without being more convincing.
 */
@DisplayName("Refresh origin gate — who is allowed to rotate")
class RefreshOriginGateTest {

    private static final String OURS = "https://www.punenest.in";
    private static final String SIBLING = "https://status.punenest.in";

    private final RefreshOriginGate gate = new RefreshOriginGate(List.of(OURS));

    private static MockHttpServletRequest request(String fetchSite, String origin) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/auth/refresh");
        if (fetchSite != null) request.addHeader("Sec-Fetch-Site", fetchSite);
        if (origin != null) request.addHeader("Origin", origin);
        return request;
    }

    @Test
    @DisplayName("allows a request from our own origin (the same-origin deployment)")
    void allowsSameOrigin() {
        // Every same-origin topology lands here: the Vite dev proxy, and any production layout that
        // serves the API under the frontend's own domain. Note the Origin is one the allow-list does
        // *not* contain -- in dev the proxy rewrites it to the proxy target -- which is the point:
        // the fetch metadata alone has to be enough, or dev and e2e break on every refresh.
        assertThatCode(() -> gate.check(request("same-origin", "http://localhost:8081")))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("allows a caller that sends no fetch metadata at all")
    void allowsNonBrowserCaller() {
        // curl, contract tests, a future mobile client. Deliberately fails open: the attack needs a
        // browser to supply the victim's cookie, so a caller with no ambient cookie jar closes
        // nothing when refused and breaks a great deal.
        assertThatCode(() -> gate.check(request(null, null))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("allows a user-initiated navigation")
    void allowsUserInitiated() {
        assertThatCode(() -> gate.check(request("none", null))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("allows the configured frontend when it is a same-site sibling")
    void allowsConfiguredSameSiteOrigin() {
        // The sibling-subdomain topology: www -> api is genuinely same-site, so the *only* thing
        // separating our frontend from the attacker's page is which origin it is. If this test ever
        // fails, production stops refreshing entirely.
        assertThatCode(() -> gate.check(request("same-site", OURS))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("refuses an unlisted sibling subdomain — the forced sign-out")
    void refusesUnlistedSibling() {
        assertThatThrownBy(() -> gate.check(request("same-site", SIBLING)))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("refuses a same-site request that carries no Origin")
    void refusesSameSiteWithoutOrigin() {
        // A browser that says "same-site" on a POST always sends Origin, so this shape is not one we
        // serve; failing closed costs nothing and avoids a header-stripping proxy becoming a bypass.
        assertThatThrownBy(() -> gate.check(request("same-site", null)))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("refuses an unlisted cross-site origin")
    void refusesCrossSite() {
        // Lax already withholds the cookie here, so the outcome would be a 401 either way. The value
        // of refusing first is that the request gets no side effect at all -- in particular it does
        // not reach AuthController.clearHint, which would otherwise let a third-party page expire the
        // victim's session hint from their own jar.
        assertThatThrownBy(() -> gate.check(request("cross-site", "https://evil.example")))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("matches origins exactly, as CORS does")
    void matchesExactly() {
        // No trailing-slash forgiveness and no case folding, because CorsConfig grants neither. A
        // configured origin with a stray slash is already broken for the browser; making it work
        // here would produce a deployment where the gate and CORS disagree about who our frontend
        // is, which is a much harder symptom to read than one consistent refusal.
        assertThatThrownBy(() -> gate.check(request("same-site", OURS + "/")))
                .isInstanceOf(ForbiddenException.class);
        assertThatThrownBy(() -> gate.check(request("same-site", "https://WWW.punenest.in")))
                .isInstanceOf(ForbiddenException.class);
    }

    @Test
    @DisplayName("refuses with 403 and a forbidden code, not a 401")
    void refusesAsForbidden() {
        // Not for the attacker's benefit -- CORS hides the status from them either way -- but for
        // ours. 401s from this endpoint are ordinary background noise from expired sessions; burying
        // a subdomain takeover in them would waste the only signal it produces.
        assertThatThrownBy(() -> gate.check(request("same-site", SIBLING)))
                .isInstanceOfSatisfying(ForbiddenException.class, e -> {
                    assertThat(e.getStatus()).isEqualTo(403);
                    assertThat(e.getCode()).isEqualTo("forbidden");
                    // The message must not echo the origin back: it reaches the client verbatim, and
                    // an endpoint that reflects attacker-controlled text is a habit worth not
                    // starting. The origin belongs in the log line, which only we read.
                    assertThat(e.getMessage()).doesNotContain(SIBLING);
                });
    }
}
