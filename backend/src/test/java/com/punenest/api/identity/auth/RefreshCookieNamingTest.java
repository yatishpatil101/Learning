package com.punenest.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.security.JwtProperties;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseCookie;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * The {@code __Host-} shape, which no other test in the suite can reach.
 *
 * <p>Every {@code @SpringBootTest} here runs on one profile, so it exercises one value of
 * {@code refresh-cookie.secure} and therefore one set of cookie names — and it is the <em>other</em>
 * one that ships. A prefix that silently failed its own constraints would look perfect in CI and be
 * rejected outright by the browser in production, where the symptom is not an error but an empty
 * cookie jar: every session dying at the fifteen-minute mark with the logs of ordinary anonymous
 * traffic. That is the exact class of profile-shaped blindness {@code CookieDeliveryCheck} exists to
 * abolish, so it would be poor form to reintroduce it here.
 *
 * <p>Plain constructor calls rather than a context: the naming rule is a pure function of one
 * boolean, and a test that had to boot Spring to ask would be slower and no more convincing.
 */
@DisplayName("Refresh cookie naming — the __Host- prefix and what it demands")
class RefreshCookieNamingTest {

    private static final JwtProperties JWT =
            new JwtProperties("x".repeat(48), Duration.ofMinutes(15), Duration.ofDays(30), Duration.ofSeconds(15));

    private static RefreshCookie secure(boolean secure) {
        return new RefreshCookie(JWT, secure, "Lax");
    }

    /**
     * The prefix is the only thing that stops a sibling host planting a twin.
     *
     * <p>{@code Secure}, {@code HttpOnly} and {@code SameSite} all constrain what a <em>page</em>
     * may do with a cookie; none of them constrain what another host under the registrable domain
     * may put in the jar. A {@code Domain=.punenest.in} twin is a distinct entry that neither our
     * clear nor the client's can remove, and it turns a best-effort sign-out into a sign-back-in and
     * an ITP recovery into a session fixation. Browsers refuse to store a {@code __Host-} cookie at
     * all unless it is host-only, so the prefix converts "we set no Domain" into "no one can".
     */
    @Test
    void aSecureDeploymentPrefixesBothCookies() {
        RefreshCookie cookie = secure(true);
        assertThat(cookie.name()).isEqualTo("__Host-punenest_rt");
        assertThat(cookie.hintName()).isEqualTo("__Host-punenest_session");
    }

    /**
     * The prefix is refused without {@code Secure}, so plain-http development keeps the bare names.
     *
     * <p>Not a concession — a browser would reject the {@code Set-Cookie} outright and the developer
     * would see no session at all.
     */
    @Test
    void plainHttpDevelopmentKeepsTheBareNames() {
        RefreshCookie cookie = secure(false);
        assertThat(cookie.name()).isEqualTo("punenest_rt");
        assertThat(cookie.hintName()).isEqualTo("punenest_session");
    }

    /**
     * Every cookie the prefixed deployment emits must satisfy the prefix's own rules.
     *
     * <p>The clears matter as much as the issues: a clear the browser rejects leaves the credential
     * in place while the application believes it is gone, which is worse than never clearing at all
     * because nothing downstream will look again.
     */
    @Test
    void everyPrefixedCookieMeetsTheHostRules() {
        RefreshCookie cookie = secure(true);
        for (ResponseCookie c : new ResponseCookie[] {
                cookie.issued("token", true), cookie.issued("token", false), cookie.cleared(),
                cookie.issuedHint(true), cookie.issuedHint(false), cookie.clearedHint() }) {
            assertThat(c.getName()).startsWith("__Host-");
            assertThat(c.isSecure())
                    .as("%s: a __Host- cookie without Secure is rejected outright", c.getName())
                    .isTrue();
            assertThat(c.getPath())
                    .as("%s: __Host- mandates Path=/, and the hint additionally needs it to be "
                            + "readable from whatever page the visitor landed on", c.getName())
                    .isEqualTo("/");
            assertThat(c.getDomain())
                    .as("%s: any Domain at all voids the prefix — and the domain cookie is exactly "
                            + "the attack it exists to stop", c.getName())
                    .isNull();
        }
    }

    /**
     * Two cookies of one name is an attack signature, not a value to pick from.
     *
     * <p>Which one the servlet hands over first is creation-ordered and unspecifiable, so honouring
     * either is a coin flip on whose session the caller ends up in — and one of the two candidates
     * arrived from somewhere we do not control. Refusing both costs a real user one sign-in.
     */
    @Test
    void aDuplicatedCookieIsRefusedRatherThanChosenBetween() {
        RefreshCookie cookie = secure(false);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("punenest_rt", "ours"), new Cookie("punenest_rt", "planted"));

        assertThat(cookie.presented(request)).isNull();
    }

    @Test
    void theTokenIsReadUnderWhicheverNameThisDeploymentUses() {
        MockHttpServletRequest prod = new MockHttpServletRequest();
        prod.setCookies(new Cookie("__Host-punenest_rt", "token"), new Cookie("punenest_rt", "stale"));
        assertThat(secure(true).presented(prod))
                .as("the unprefixed leftover of a pre-prefix session must not be mistaken for the real one")
                .isEqualTo("token");

        MockHttpServletRequest dev = new MockHttpServletRequest();
        dev.setCookies(new Cookie("punenest_rt", "token"));
        assertThat(secure(false).presented(dev)).isEqualTo("token");
    }

    /** No jar, an empty value, and a jar without ours are all "no token presented". */
    @Test
    void anAbsentOrEmptyCookieReadsAsNoSession() {
        RefreshCookie cookie = secure(false);
        assertThat(cookie.presented(new MockHttpServletRequest())).isNull();

        MockHttpServletRequest blank = new MockHttpServletRequest();
        blank.setCookies(new Cookie("punenest_rt", ""));
        assertThat(cookie.presented(blank)).isNull();

        MockHttpServletRequest other = new MockHttpServletRequest();
        other.setCookies(new Cookie("punenest_session", "1"));
        assertThat(cookie.presented(other)).isNull();
    }
}
