package com.draazy.api.provider.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.provider.PushPayloads;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

@DisplayName("Web Push sender")
class WebPushSenderTest {

    // RFC 8291 appendix A.
    private static final String RFC_AS_PUBLIC =
            "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private static final String RFC_AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    private static final String RFC_UA_PUBLIC =
            "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private static final String RFC_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
    private static final String RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw";
    private static final String RFC_HEADER = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg"
            + "Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private static final String RFC_CIPHERTEXT =
            "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ";

    private final AtomicInteger status = new AtomicInteger(201);
    private final AtomicReference<Headers> seenHeaders = new AtomicReference<>();
    private final AtomicReference<byte[]> seenBody = new AtomicReference<>();
    private final AtomicInteger requests = new AtomicInteger();
    private HttpServer server;
    private KeyPair vapid;
    private KeyPair browser;
    private byte[] browserAuth;

    @BeforeEach
    void startFakePushService() throws Exception {
        vapid = WebPushCrypto.newKeyPair();
        browser = WebPushCrypto.newKeyPair();
        browserAuth = new byte[16];
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/push/token", exchange -> {
            requests.incrementAndGet();
            seenHeaders.set(exchange.getRequestHeaders());
            seenBody.set(exchange.getRequestBody().readAllBytes());
            exchange.sendResponseHeaders(status.get(), -1);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopFakePushService() {
        server.stop(0);
    }

    private PushProperties props(String subject) {
        return new PushProperties(WebPushCrypto.encode(WebPushCrypto.uncompressed(vapid.getPublic())),
                WebPushCrypto.encode(scalar(vapid.getPrivate())), subject);
    }

    private WebPushSender openSender() {
        return new WebPushSender(props("mailto:ops@example.test"), JsonMapper.builder().build(),
                HttpClient.newHttpClient(), uri -> true);
    }

    private boolean push(WebPushSender sender) {
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort() + "/push/token";
        return sender.send(endpoint, WebPushCrypto.encode(WebPushCrypto.uncompressed(browser.getPublic())),
                WebPushCrypto.encode(browserAuth), PushPayloads.messageReceived(UUID.randomUUID()));
    }

    private static byte[] scalar(PrivateKey key) {
        byte[] raw = ((ECPrivateKey) key).getS().toByteArray();
        byte[] out = new byte[32];
        int length = Math.min(raw.length, 32);
        System.arraycopy(raw, raw.length - length, out, 32 - length, length);
        return out;
    }

    @Test
    @DisplayName("the RFC 8291 example message encrypts to the RFC's exact bytes")
    void matchesRfcVector() throws Exception {
        PrivateKey asPrivate = WebPushCrypto.privateKey(RFC_AS_PRIVATE);
        PublicKey asPublic = WebPushCrypto.publicKey(WebPushCrypto.decode(RFC_AS_PUBLIC));

        byte[] body = WebPushCrypto.encrypt(
                "When I grow up, I want to be a watermelon".getBytes(StandardCharsets.UTF_8),
                WebPushCrypto.decode(RFC_UA_PUBLIC), WebPushCrypto.decode(RFC_AUTH),
                new KeyPair(asPublic, asPrivate), WebPushCrypto.decode(RFC_SALT));

        byte[] header = WebPushCrypto.decode(RFC_HEADER);
        byte[] ciphertext = WebPushCrypto.decode(RFC_CIPHERTEXT);
        byte[] expected = Arrays.copyOf(header, header.length + ciphertext.length);
        System.arraycopy(ciphertext, 0, expected, header.length, ciphertext.length);
        assertThat(body).isEqualTo(expected);
    }

    @Test
    @DisplayName("a push is POSTed to the endpoint encrypted and signed with the VAPID key")
    void deliversSignedEncryptedPush() throws Exception {
        assertThat(push(openSender())).isTrue();

        assertThat(requests).hasValue(1);
        Headers headers = seenHeaders.get();
        assertThat(headers.getFirst("Content-Encoding")).isEqualTo("aes128gcm");
        assertThat(headers.getFirst("TTL")).isEqualTo("86400");

        String authorization = headers.getFirst("Authorization");
        assertThat(authorization).startsWith("vapid t=")
                .endsWith(", k=" + WebPushCrypto.encode(WebPushCrypto.uncompressed(vapid.getPublic())));
        String[] jwt = authorization.substring("vapid t=".length(), authorization.indexOf(", k=")).split("\\.");
        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(vapid.getPublic());
        verifier.update((jwt[0] + "." + jwt[1]).getBytes(StandardCharsets.US_ASCII));
        assertThat(verifier.verify(WebPushCrypto.decode(jwt[2]))).isTrue();
        assertThat(new String(WebPushCrypto.decode(jwt[1]), StandardCharsets.UTF_8))
                .contains("\"aud\":\"http://127.0.0.1:" + server.getAddress().getPort() + "\"")
                .contains("\"sub\":\"mailto:ops@example.test\"");

        byte[] body = seenBody.get();
        assertThat(Arrays.copyOfRange(body, 16, 20)).containsExactly(0, 0, 16, 0);
        assertThat(body[20]).isEqualTo((byte) 65);
        assertThat(WebPushCrypto.publicKey(Arrays.copyOfRange(body, 21, 86))).isNotNull();
    }

    @ParameterizedTest(name = "http {0} means the subscription is gone")
    @ValueSource(ints = {404, 410})
    @DisplayName("an expired subscription is reported so it can be removed")
    void expiredSubscriptionIsReported(int code) {
        status.set(code);

        assertThat(push(openSender())).isFalse();
    }

    @ParameterizedTest(name = "http {0} keeps the subscription")
    @ValueSource(ints = {400, 429, 500, 503})
    @DisplayName("a transient failure never deletes a subscription")
    void transientFailureKeepsSubscription(int code) {
        status.set(code);

        assertThat(push(openSender())).isTrue();
    }

    @Test
    @DisplayName("an unreachable push service keeps the subscription")
    void unreachableKeepsSubscription() {
        WebPushSender sender = openSender();
        server.stop(0);

        assertThat(push(sender)).isTrue();
    }

    @Test
    @DisplayName("an endpoint the production policy rejects is dropped without a request being made")
    void rejectedEndpointIsDropped() {
        WebPushSender strict = new WebPushSender(props(null), JsonMapper.builder().build(),
                HttpClient.newHttpClient(), WebPushSender::isPublicHttps);

        assertThat(push(strict)).isFalse();
        assertThat(requests).hasValue(0);
    }

    @ParameterizedTest
    @ValueSource(strings = {"http://fcm.googleapis.com/fcm/send/x", "https://127.0.0.1/x", "https://localhost/x",
            "https://169.254.169.254/latest", "https://10.0.0.5/x", "https://[::1]/x", "https://[fd00::1]/x",
            "https://user@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://100.100.100.200/x",
            "https://0.0.0.0/x", "https://198.18.0.1/x", "https://[64:ff9b::7f00:1]/x"})
    @DisplayName("the production policy admits only public https endpoints on the default port")
    void policyRejectsInternalTargets(String endpoint) {
        assertThat(WebPushSender.isPublicHttps(URI.create(endpoint))).isFalse();
    }

    @Test
    @DisplayName("a public key that is not the half of the private key fails at startup")
    void mismatchedPairFailsFast() {
        PushProperties mismatched = new PushProperties(
                WebPushCrypto.encode(WebPushCrypto.uncompressed(browser.getPublic())),
                WebPushCrypto.encode(scalar(vapid.getPrivate())), null);

        assertThatThrownBy(() -> new WebPushSender(mismatched, JsonMapper.builder().build(),
                HttpClient.newHttpClient(), uri -> true)).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("public half");
    }

    @Test
    @DisplayName("a key that is not a P-256 pair fails at startup, not at the first push")
    void badKeysFailFast() {
        PushProperties bad = new PushProperties("AAAA", "AAAA", null);

        assertThatThrownBy(() -> new WebPushSender(bad, JsonMapper.builder().build(),
                HttpClient.newHttpClient(), uri -> true)).isInstanceOf(IllegalStateException.class);
    }
}
