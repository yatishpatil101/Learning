package com.draazy.api.common.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/**
 * The refresh cookie's delivery invariant, asserted where it can still be acted on.
 *
 * <p>These are plain constructor calls rather than a Spring context, because the thing under test is
 * a decision made from three strings and the interesting cases are all misconfigurations — a
 * {@code @SpringBootTest} per case would boot the application to ask a question that has no
 * dependencies.
 *
 * <p>What makes the check worth having, and these tests worth reading, is that the failure it
 * catches has no runtime symptom: a cross-site UI gets its refresh cookie silently withheld by the
 * browser, so {@code /auth/refresh} 401s and every session dies at the first access-token expiry,
 * indistinguishable in the logs from a visitor who was never signed in.
 */
class CookieDeliveryCheckTest {

    private static CookieDeliveryCheck check(String publicOrigin, List<String> allowed) {
        return new CookieDeliveryCheck(publicOrigin, allowed, "Lax");
    }

    @Test
    @DisplayName("a UI proxied on the API's own origin passes")
    void sameOriginPasses() {
        assertThatCode(() -> check("https://draazy.com", List.of("https://draazy.com")).verify())
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("sibling subdomains pass — cross-origin, but same-site, so Lax is still delivered")
    void siblingSubdomainsPass() {
        assertThatCode(() -> check("https://api.draazy.com",
                List.of("https://www.draazy.com", "https://draazy.com")).verify())
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a UI on its own registrable domain refuses to boot")
    void crossSiteFails() {
        assertThatThrownBy(() -> check("https://api.draazy.com",
                List.of("https://draazy.netlify.app")).verify())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("https://draazy.netlify.app")
                // The message has to carry the fix, because the person reading it is looking at a
                // container that will not start and has no other evidence of what is wrong.
                .hasMessageContaining("proxy /api");
    }

    /**
     * The Public Suffix List case, which is the one a naive two-label comparison gets wrong: both
     * hosts end in {@code netlify.app}, so "same last two labels" would call them same-site and let
     * a deployment through that cannot work.
     */
    @Test
    @DisplayName("two subdomains of a public suffix are different sites")
    void publicSuffixSubdomainsAreNotSameSite() {
        assertThatThrownBy(() -> check("https://api.netlify.app",
                List.of("https://draazy.netlify.app")).verify())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("one bad origin among good ones still fails, and names only itself")
    void aSingleStrayOriginIsEnough() {
        assertThatThrownBy(() -> check("https://api.draazy.com",
                List.of("https://www.draazy.com", "https://staging.draazy.dev")).verify())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("staging.draazy.dev")
                .hasMessageNotContaining("www.draazy.com");
    }

    /**
     * Dev and the e2e harness reach the API through the Vite proxy, where the UI and the API share
     * an origin by construction. There is nothing to compare, and refusing to start on that would
     * make a correct local setup unbootable.
     */
    @Test
    @DisplayName("an unset public origin skips the check rather than failing it")
    void unsetPublicOriginSkips() {
        assertThatCode(() -> check("", List.of("http://localhost:5173")).verify())
                .doesNotThrowAnyException();
    }

    /**
     * {@code SameSite=None} makes the question moot — the browser delivers the cookie cross-site —
     * so there is nothing to reject. It is not free, and the class logs the CSRF debt it takes on;
     * what this test pins is only that choosing it does not also have to satisfy a same-site rule
     * that no longer applies.
     */
    @Test
    @DisplayName("SameSite=None is not held to the same-site rule")
    void sameSiteNoneSkips() {
        assertThatCode(() -> new CookieDeliveryCheck("https://api.draazy.com",
                List.of("https://draazy.netlify.app"), "None").verify())
                .doesNotThrowAnyException();
    }

    /**
     * localhost has one label, so there is no registrable domain to take. Falling back to the host
     * keeps the comparison strict: two values that cannot be decomposed have to match exactly.
     */
    @Test
    @DisplayName("localhost compares by host, ports and schemes ignored")
    void localhostComparesByHost() {
        assertThatCode(() -> check("http://localhost:8080", List.of("http://localhost:5173")).verify())
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> check("http://localhost:8080", List.of("http://127.0.0.1:5173")).verify())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("the failure message names the site it computed, not just the origins")
    void theMessageExplainsTheComparison() {
        assertThat(catchMessage(() -> check("https://api.draazy.com",
                List.of("https://draazy.netlify.app")).verify()))
                .contains("draazy.com")
                .contains("SameSite=Lax")
                .contains("draazy.web.public-origin");
    }

    /**
     * The sibling-subdomain topology boots, and says out loud what it costs.
     *
     * <p>This is the case the same-site check alone reads as a clean pass, and it is a clean pass for
     * the refresh cookie. It is not one for the readable {@code draazy_session} hint, which is
     * host-only because {@code __Host-} forbids the {@code Domain} attribute that would widen it —
     * so a UI on {@code www} cannot see a hint set on {@code api}, and the Safari ITP recovery that
     * hint exists to drive never runs. Nothing errors and no session is lost that was not already
     * being lost, which is exactly why it needs saying at boot: the alternative is a feature that is
     * inert in production and works in every environment anyone tests it in.
     */
    @Test
    @DisplayName("sibling subdomains warn that the session hint cannot be read")
    void siblingSubdomainsWarnAboutTheHint() {
        ListAppender<ILoggingEvent> heard = captureLogs();
        check("https://api.draazy.com", List.of("https://www.draazy.com")).verify();

        assertThat(heard.list)
                .filteredOn(e -> e.getLevel() == Level.WARN)
                .singleElement()
                .satisfies(e -> {
                    String message = e.getFormattedMessage();
                    assertThat(message).contains("https://www.draazy.com");
                    // The operator's instinct on reading "unreadable cookie" is to add a Domain,
                    // which trades a dead feature for a session-fixation hole. The warning has to
                    // carry the correct repair and the forbidden one.
                    assertThat(message).contains("path proxy");
                    assertThat(message).contains("Do NOT give the hint a Domain");
                });
    }

    @Test
    @DisplayName("a proxied UI is silent — a warning that fires on a healthy setup is one nobody reads")
    void theProxiedTopologyWarnsAboutNothing() {
        ListAppender<ILoggingEvent> heard = captureLogs();
        check("https://draazy.com", List.of("https://draazy.com")).verify();

        assertThat(heard.list).filteredOn(e -> e.getLevel() == Level.WARN).isEmpty();
    }

    private static ListAppender<ILoggingEvent> captureLogs() {
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logbackLogger().addAppender(appender);
        return appender;
    }

    /**
     * Detaches the capture so it cannot outlive its test.
     *
     * <p>Appenders attach to a process-wide logger, so one left behind would keep collecting events
     * from every later test in the JVM. That does not fail anything here — each test reads only its
     * own list — but a listener that survives the thing that installed it is how a suite acquires
     * order-dependent behaviour, and the cost of not having it is one line.
     */
    @AfterEach
    void detachCapture() {
        logbackLogger().detachAndStopAllAppenders();
    }

    private static ch.qos.logback.classic.Logger logbackLogger() {
        return (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(CookieDeliveryCheck.class);
    }

    private static String catchMessage(Runnable r) {
        try {
            r.run();
            throw new AssertionError("expected the check to reject this configuration");
        } catch (IllegalStateException e) {
            return e.getMessage();
        }
    }
}
