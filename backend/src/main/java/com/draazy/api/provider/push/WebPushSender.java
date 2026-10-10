package com.draazy.api.provider.push;

import com.draazy.api.provider.PushPayloads;
import com.draazy.api.provider.PushSender;
import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.function.Predicate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Selected when a VAPID private key is configured; otherwise {@code LoggingPushSender} is wired
 * and nothing leaves the process. */
@Component
@ConditionalOnExpression("!'${draazy.providers.push.vapid-private-key:}'.isBlank()")
class WebPushSender implements PushSender {

    private static final Logger log = LoggerFactory.getLogger(WebPushSender.class);
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration JWT_LIFETIME = Duration.ofHours(12);
    private static final String DEFAULT_SUBJECT = "mailto:noreply@draazy.com";

    private final ObjectMapper json;
    private final HttpClient http;
    private final PrivateKey privateKey;
    private final String publicKey;
    private final String subject;
    private final Predicate<URI> endpointPolicy;

    @Autowired
    WebPushSender(PushProperties props, ObjectMapper json) {
        this(props, json, HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build(),
                WebPushSender::isPublicHttps);
    }

    WebPushSender(PushProperties props, ObjectMapper json, HttpClient http, Predicate<URI> endpointPolicy) {
        if (props.vapidPublicKey() == null || props.vapidPublicKey().isBlank()) {
            throw new IllegalStateException(
                    "draazy.providers.push.vapid-private-key is set but vapid-public-key is blank "
                            + "(PUSH_VAPID_PUBLIC_KEY). Supply both or neither.");
        }
        this.json = json;
        this.http = http;
        this.endpointPolicy = endpointPolicy;
        this.publicKey = props.vapidPublicKey().strip();
        this.subject = props.subject() == null || props.subject().isBlank()
                ? DEFAULT_SUBJECT : props.subject().strip();
        try {
            PublicKey vapidPublic = WebPushCrypto.publicKey(WebPushCrypto.decode(publicKey));
            this.privateKey = WebPushCrypto.privateKey(props.vapidPrivateKey());
            WebPushCrypto.vapidJwt(privateKey, "https://localhost", subject, 0);
            if (!WebPushCrypto.isPair(privateKey, vapidPublic)) {
                throw new IllegalStateException("PUSH_VAPID_PUBLIC_KEY is not the public half of "
                        + "PUSH_VAPID_PRIVATE_KEY; every push would be rejected.");
            }
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException(
                    "The VAPID key pair (PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY) is not a valid "
                            + "base64url P-256 pair; generate one with `npx web-push generate-vapid-keys`.", e);
        }
    }

    @Override
    public boolean send(String endpoint, String p256dh, String auth, PushPayloads.Payload payload) {
        URI uri;
        try {
            uri = URI.create(endpoint);
        } catch (IllegalArgumentException e) {
            return false;
        }
        if (!endpointPolicy.test(uri)) {
            log.warn("Push endpoint rejected: not a public https URL");
            return false;
        }
        HttpRequest request;
        try {
            byte[] body = WebPushCrypto.encrypt(
                    json.writeValueAsString(Map.of("title", payload.title(), "body", payload.body(),
                            "url", payload.url())).getBytes(StandardCharsets.UTF_8),
                    WebPushCrypto.decode(p256dh), WebPushCrypto.decode(auth));
            request = HttpRequest.newBuilder(uri)
                    .timeout(RESPONSE_TIMEOUT)
                    .header("Content-Encoding", "aes128gcm")
                    .header("Content-Type", "application/octet-stream")
                    .header("TTL", "86400")
                    .header("Urgency", "normal")
                    .header("Authorization", authorization(uri))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
        } catch (IllegalArgumentException | GeneralSecurityException e) {
            log.warn("Push subscription for {} has unusable keys: {}", uri.getHost(), e.getMessage());
            return false;
        }
        try {
            int status = http.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
            if (status == 404 || status == 410) {
                return false;
            }
            if (status < 200 || status >= 300) {
                log.warn("Push to {} failed: http {}", uri.getHost(), status);
            }
        } catch (IOException e) {
            log.warn("Push to {} failed: {}", uri.getHost(), e.toString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return true;
    }

    private String authorization(URI endpoint) throws GeneralSecurityException {
        String audience = endpoint.getScheme() + "://" + endpoint.getRawAuthority();
        long expires = Instant.now().plus(JWT_LIFETIME).getEpochSecond();
        return "vapid t=" + WebPushCrypto.vapidJwt(privateKey, audience, subject, expires) + ", k=" + publicKey;
    }

    // The endpoint is client-supplied and this server POSTs to it.
    static boolean isPublicHttps(URI uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || (uri.getPort() != -1 && uri.getPort() != 443)) {
            return false;
        }
        try {
            for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
                if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress() || address.isMulticastAddress() || isReserved(address)) {
                    return false;
                }
            }
        } catch (UnknownHostException e) {
            return true;
        }
        return true;
    }

    // Ranges the JDK predicates miss: 0.0.0.0/8, carrier-grade NAT (cloud metadata lives there on some
    // providers), benchmarking, IPv6 unique-local and the NAT64 prefix.
    private static boolean isReserved(InetAddress address) {
        byte[] b = address.getAddress();
        if (b.length == 4) {
            int first = b[0] & 0xff;
            int second = b[1] & 0xff;
            return first == 0 || (first == 100 && (second & 0xc0) == 0x40) || (first == 198 && (second & 0xfe) == 18);
        }
        return (b[0] & 0xfe) == 0xfc || (b[0] == 0 && b[1] == 0x64 && (b[2] & 0xff) == 0xff && (b[3] & 0xff) == 0x9b);
    }
}
