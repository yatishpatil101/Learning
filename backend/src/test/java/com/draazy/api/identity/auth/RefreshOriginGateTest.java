package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.ForbiddenException;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
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

    private static final String OURS = "https://www.draazy.in";
    private static final String SIBLING = "https://status.draazy.in";

    private final RefreshOriginGate gate = new RefreshOriginGate(List.of(OURS));

    private static MockHttpServletRequest request(String fetchSite, String origin) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/auth/refresh");
        if (fetchSite != null) request.addHeader("Sec-Fetch-Site", fetchSite);
        if (origin != null) request.addHeader("Origin", origin);
        return request;
    }

    /**
     * Same-origin alone must be enough — in dev the proxy rewrites Origin to a value the allow-list
     * does not contain, or dev and e2e break on every refresh. No fetch metadata at all (curl,
     * contract tests, a future mobile client) fails open: the attack needs a browser to supply the
     * victim's cookie, so refusing a caller with no ambient cookie jar breaks a great deal and closes
     * nothing. A same-site sibling is allowed only when it is the configured frontend; if that row
     * fails, production stops refreshing entirely.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("allowed")
    void allows(String label, String fetchSite, String origin) {
        assertThatCode(() -> gate.check(request(fetchSite, origin))).doesNotThrowAnyException();
    }

    static Stream<Arguments> allowed() {
        return Stream.of(
                Arguments.of("our own origin (the same-origin deployment)", "same-origin",
                        "http://localhost:8081"),
                Arguments.of("a caller that sends no fetch metadata at all", null, null),
                Arguments.of("a user-initiated navigation", "none", null),
                Arguments.of("the configured frontend when it is a same-site sibling", "same-site",
                        OURS));
    }

    /**
     * A same-site request with no Origin is a shape a browser never sends on a POST, so failing
     * closed costs nothing and stops a header-stripping proxy becoming a bypass. A cross-site origin
     * would be a 401 anyway (Lax withholds the cookie), but refusing first means the request never
     * reaches {@code AuthController.clearHint}, which would let a third-party page expire the
     * victim's session hint.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("refused")
    void refuses(String label, String fetchSite, String origin) {
        assertThatThrownBy(() -> gate.check(request(fetchSite, origin)))
                .isInstanceOf(ForbiddenException.class);
    }

    static Stream<Arguments> refused() {
        return Stream.of(
                Arguments.of("an unlisted sibling subdomain — the forced sign-out", "same-site",
                        SIBLING),
                Arguments.of("a same-site request that carries no Origin", "same-site", null),
                Arguments.of("an unlisted cross-site origin", "cross-site", "https://evil.example"));
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
        assertThatThrownBy(() -> gate.check(request("same-site", "https://WWW.draazy.in")))
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
