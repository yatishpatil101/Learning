package com.draazy.api.provider.places;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.provider.PlacesLookup.Place;
import com.draazy.api.provider.PlacesLookup.UnavailableException;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Google Places lookup — response handling")
class GooglePlacesLookupTest {

    private HttpServer server;
    private final AtomicReference<Integer> status = new AtomicReference<>(200);
    private final AtomicReference<String> body = new AtomicReference<>("{}");
    private final AtomicReference<String> seenKey = new AtomicReference<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            seenKey.set(exchange.getRequestHeaders().getFirst("X-Goog-Api-Key"));
            byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status.get(), bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private GooglePlacesLookup lookup() {
        return new GooglePlacesLookup(" secret-key ", "http://127.0.0.1:" + server.getAddress().getPort(), 2, 2);
    }

    private void respond(int code, String json) {
        status.set(code);
        body.set(json);
    }

    @Test
    @DisplayName("the id Google returns is the canonical one, and the key is sent trimmed")
    void canonicalIdWins() {
        respond(200, """
                {"id":"canonical-id","displayName":{"text":"Kumar Pinnacle"},
                 "location":{"latitude":18.5,"longitude":73.8},"types":["premise"]}""");

        Optional<Place> place = lookup().details("requested-id", null);

        assertThat(place).get().extracting(Place::placeId, Place::name).containsExactly("canonical-id", "Kumar Pinnacle");
        assertThat(seenKey.get()).isEqualTo("secret-key");
    }

    @Test
    @DisplayName("404 and a 400 about the id mean the place is unknown")
    void unknownPlaces() {
        respond(404, "{\"error\":{\"code\":404,\"status\":\"NOT_FOUND\"}}");
        assertThat(lookup().details("x", null)).isEmpty();

        respond(400, "{\"error\":{\"code\":400,\"status\":\"INVALID_ARGUMENT\",\"message\":\"Invalid place id\"}}");
        assertThat(lookup().details("x", null)).isEmpty();
    }

    @Test
    @DisplayName("a 400 or 403 about the key says nothing about the place, so it is unavailable")
    void keyProblemsAreUnavailable() {
        respond(400, """
                {"error":{"code":400,"status":"INVALID_ARGUMENT",
                 "details":[{"reason":"API_KEY_INVALID"}]}}""");
        assertThatThrownBy(() -> lookup().details("x", null))
                .isInstanceOf(UnavailableException.class)
                .hasMessageContaining("API_KEY_INVALID")
                .hasMessageNotContaining("secret-key");

        respond(403, "{\"error\":{\"code\":403,\"status\":\"PERMISSION_DENIED\"}}");
        assertThatThrownBy(() -> lookup().details("x", null))
                .isInstanceOf(UnavailableException.class)
                .hasMessageContaining("403")
                .hasMessageContaining("PERMISSION_DENIED");
    }
}
