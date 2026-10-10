package com.draazy.api.provider.zeptomail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.draazy.api.provider.ProviderCalls;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@DisplayName("ZeptoMail email sender")
@ExtendWith(OutputCaptureExtension.class)
class ZeptoMailEmailSenderTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpServer server;
    private final AtomicReference<String> auth = new AtomicReference<>();
    private final AtomicReference<String> body = new AtomicReference<>();

    @AfterEach
    void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    private String start(int status, String reply) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1.1/email", exchange -> {
            auth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] out = reply.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/";
    }

    private final ProviderCalls calls = mock(ProviderCalls.class);

    private ZeptoMailEmailSender sender(String baseUrl, String key) {
        return new ZeptoMailEmailSender(
                new ZeptoMailProperties(true, baseUrl, key, "noreply@draazy.com", "Draazy"), JSON, calls);
    }

    @Test
    @DisplayName("posts the documented payload with the Zoho-enczapikey scheme added once")
    void sendsDocumentedPayload() throws Exception {
        String base = start(201, "{\"data\":[]}");

        sender(base, "secret-token").send("hire@example.com", "Subject line", "Body with link");
        assertThat(auth.get()).isEqualTo("Zoho-enczapikey secret-token");
        JsonNode sent = JSON.readTree(body.get());
        assertThat(sent.path("from").path("address").asString()).isEqualTo("noreply@draazy.com");
        assertThat(sent.path("to").get(0).path("email_address").path("address").asString())
                .isEqualTo("hire@example.com");
        assertThat(sent.path("subject").asString()).isEqualTo("Subject line");
        assertThat(sent.path("textbody").asString()).isEqualTo("Body with link");
        assertThat(sent.path("track_clicks").asBoolean()).isFalse();
        verify(calls).record(eq(ProviderCalls.ZEPTOMAIL), eq("email"), eq(ProviderCalls.Outcome.OK),
                eq("hire@example.com"), eq("Subject line"), isNull(), anyInt());

        sender(base, "Zoho-enczapikey secret-token").send("hire@example.com", "s", "t");
        assertThat(auth.get()).isEqualTo("Zoho-enczapikey secret-token");
    }

    @Test
    @DisplayName("a vendor refusal is swallowed and logged as codes, never the token, address or body")
    void refusalIsSwallowedAndRedacted(CapturedOutput output) throws Exception {
        String base = start(401, """
                {"error":{"code":"TM_4001","details":[{"code":"SERR_157",
                "message":"Invalid API Token found for hire@example.com"}],"message":"Access Denied"}}""");

        assertThatCode(() -> sender(base, "secret-token").send("hire@example.com", "s", "invite-link"))
                .doesNotThrowAnyException();
        assertThat(output.getAll())
                .contains("***@example.com", "TM_4001", "SERR_157")
                .doesNotContain("secret-token", "hire@", "invite-link", "Invalid API Token");
        verify(calls).record(eq(ProviderCalls.ZEPTOMAIL), eq("email"), eq(ProviderCalls.Outcome.FAILED),
                eq("hire@example.com"), eq("s"), eq("http 401 code=TM_4001 SERR_157"), anyInt());
    }
}
