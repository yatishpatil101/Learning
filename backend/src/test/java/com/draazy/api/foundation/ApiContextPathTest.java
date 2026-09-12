package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * The {@code /api} prefix, asserted against a real servlet container.
 *
 * <p><strong>Why this test exists, and why it cannot be a MockMvc test.</strong> Every route in
 * {@code Routes} is written relative to {@code /api}, and both {@code api-standards.md} and
 * {@code Routes}' own header state that the prefix is applied by configuration. For the entire life
 * of the project it was not: {@code server.servlet.context-path} appeared nowhere, the backend
 * served {@code /auth/login}, and the Vite dev proxy quietly rewrote {@code /api/*} to {@code /*} on
 * the way through. Two layers each held a coherent belief and they disagreed, which is invisible
 * until the proxy is removed — i.e. at the first deploy, where the failure is every request 404ing
 * with a healthy backend and nothing in the logs to explain it.
 *
 * <p>MockMvc cannot defend the fix. It stands in for the container rather than starting one, and it
 * does not apply {@code server.servlet.context-path} at all, so every existing HTTP test passes
 * identically whether the property is set, unset, or set to something else entirely. A test that
 * cannot fail when the thing it describes is deleted is not covering it. Hence {@code RANDOM_PORT}
 * and a real client: this is the only test in the suite that exercises the actual mapping.
 *
 * <p>The JDK's own {@code HttpClient} is used rather than {@code TestRestTemplate} because the
 * latter moved to {@code spring-boot-resttestclient} in Boot 4 and is not a declared dependency
 * here. Three GETs do not justify adding one.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@DisplayName("The /api prefix — served by the container, not invented by the dev proxy")
class ApiContextPathTest {

    @LocalServerPort
    int port;

    private int statusOf(String path) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("http://localhost:" + port + path))
                    .GET()
                    .build();
            return client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
        }
    }

    @Test
    @DisplayName("a public route answers under /api")
    void publicRouteIsServedUnderTheApiPrefix() throws Exception {
        assertThat(statusOf("/api/properties")).isEqualTo(200);
    }

    /**
     * The negative case is the half that matters. Asserting only that the prefixed path works would
     * still pass if someone later "fixed" a problem by mapping the controllers at both prefixes,
     * which reintroduces exactly the two-truths condition this test exists to prevent.
     */
    @Test
    @DisplayName("the same route is not also served without the prefix")
    void unprefixedRouteIsNotServed() throws Exception {
        assertThat(statusOf("/properties"))
                .as("mapping the API at both prefixes would hide the drift this pins")
                .isEqualTo(404);
    }

    /**
     * Recorded because it is the one operational consequence of the context path, and the kind of
     * thing that gets discovered at 3am rather than read in a properties file: the container
     * prefixes infrastructure routes too, so liveness/readiness probes must target the prefixed
     * path.
     */
    @Test
    @DisplayName("the health probe moves under the prefix with everything else")
    void healthProbeIsAlsoPrefixed() throws Exception {
        assertThat(statusOf("/api/actuator/health")).isEqualTo(200);
    }
}
