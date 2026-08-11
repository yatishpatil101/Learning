package com.punenest.api.provider.turnstile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Cloudflare Turnstile verification (tech-debt D130), against a real HTTP server on loopback.
 *
 * <p><strong>Why a real server and not a mocked client.</strong> The three things worth proving here
 * are all below the API a mock would replace: that a {@code success: false} body is a refusal, that
 * a transport failure is a refusal rather than an exception escaping into a servlet filter, and that
 * the secret reaches the provider without being logged or returned. A stubbed {@code RestClient}
 * would prove the first and assume the other two. The JDK's own {@code HttpServer} costs no
 * dependency and no fixture.
 */
@DisplayName("Turnstile verification (D130)")
class TurnstileBotDefenceTest {

    private HttpServer server;

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    /** Starts a stand-in for Cloudflare that returns {@code body} and records what it was sent. */
    private String startServer(String body) throws IOException {
        StringBuilder received = new StringBuilder();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/siteverify", exchange -> {
            received.append(new String(exchange.getRequestBody().readAllBytes(),
                    StandardCharsets.UTF_8));
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        this.lastRequestBody = received;
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/siteverify";
    }

    private StringBuilder lastRequestBody;

    private static TurnstileBotDefence defence(String verifyUrl) {
        return new TurnstileBotDefence("test-secret", verifyUrl, 2, 2);
    }

    @Test
    @DisplayName("accepts a token Cloudflare confirms")
    void acceptsSuccess() throws Exception {
        TurnstileBotDefence defence = defence(startServer("{\"success\":true}"));

        assertThat(defence.verify("a-token", "203.0.113.9")).isTrue();
    }

    @Test
    @DisplayName("sends the secret, the token and the caller address")
    void sendsTheExpectedForm() throws Exception {
        TurnstileBotDefence defence = defence(startServer("{\"success\":true}"));

        defence.verify("a-token", "203.0.113.9");

        assertThat(lastRequestBody.toString())
                .contains("secret=test-secret")
                .contains("response=a-token")
                .contains("remoteip=203.0.113.9");
    }

    @Test
    @DisplayName("refuses a token Cloudflare rejects")
    void refusesFailure() throws Exception {
        TurnstileBotDefence defence = defence(
                startServer("{\"success\":false,\"error-codes\":[\"invalid-input-response\"]}"));

        assertThat(defence.verify("a-token", null)).isFalse();
    }

    @Test
    @DisplayName("refuses a body that does not say success at all")
    void refusesUnexpectedBody() throws Exception {
        TurnstileBotDefence defence = defence(startServer("{\"unexpected\":\"shape\"}"));

        assertThat(defence.verify("a-token", null))
                .as("an absent verdict is not a positive one")
                .isFalse();
    }

    @Test
    @DisplayName("refuses when success is a string rather than a boolean")
    void refusesWrongTypedSuccess() throws Exception {
        // A proxy, a WAF error page or a future API change can all produce this. It must be a
        // refusal, not a ClassCastException surfacing as a 500 from a public endpoint.
        TurnstileBotDefence defence = defence(startServer("{\"success\":\"true\"}"));

        assertThat(defence.verify("a-token", null)).isFalse();
    }

    @Test
    @DisplayName("refuses when the provider is unreachable — fail closed, and without throwing")
    void refusesWhenUnreachable() throws Exception {
        // A port nothing is listening on: bind one to learn a free number, then release it.
        int deadPort;
        try (ServerSocket probe = new ServerSocket(0)) {
            deadPort = probe.getLocalPort();
        }
        TurnstileBotDefence defence = defence("http://127.0.0.1:" + deadPort + "/siteverify");

        assertThat(defence.verify("a-token", null))
                .as("a broken verification call must refuse, not disable the control")
                .isFalse();
    }

    @Test
    @DisplayName("refuses when the provider answers with an error status")
    void refusesOnServerError() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/siteverify", exchange -> {
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        server.start();
        TurnstileBotDefence defence =
                defence("http://127.0.0.1:" + server.getAddress().getPort() + "/siteverify");

        assertThat(defence.verify("a-token", null)).isFalse();
    }

    @Test
    @DisplayName("reports itself as enforcing, since it only exists when switched on")
    void isEnforcing() throws Exception {
        assertThat(defence(startServer("{\"success\":true}")).enforced()).isTrue();
    }

    @Test
    @DisplayName("refuses to start with the flag on and no secret, rather than failing every form")
    void refusesToStartWithoutASecret() {
        assertThatThrownBy(() -> new TurnstileBotDefence("  ", "http://127.0.0.1:1/x", 1, 1))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("secret-key");
    }
}
