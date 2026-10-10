package com.draazy.api.provider.zeptomail;

import com.draazy.api.provider.EmailSender;
import com.draazy.api.provider.ProviderCalls;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Whole-exchange deadline rather than a read timeout, for the reason given on {@code WhatsAppClient}:
 * the send runs on a request thread. */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.zeptomail", name = "enabled", havingValue = "true")
class ZeptoMailEmailSender implements EmailSender {

    private static final Logger log = LoggerFactory.getLogger(ZeptoMailEmailSender.class);
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(5);
    private static final String AUTH_SCHEME = "Zoho-enczapikey ";

    private final RestClient http;
    private final ObjectMapper json;
    private final Map<String, String> from;
    private final ProviderCalls calls;

    ZeptoMailEmailSender(ZeptoMailProperties props, ObjectMapper json, ProviderCalls calls) {
        if (isBlank(props.baseUrl()) || isBlank(props.apiKey()) || isBlank(props.fromAddress())) {
            throw new IllegalStateException(
                    "draazy.providers.zeptomail.enabled=true but base-url/api-key/from-address are not "
                            + "set (ZEPTOMAIL_BASE_URL / ZEPTOMAIL_API_KEY / ZEPTOMAIL_FROM_ADDRESS). "
                            + "Either supply them or leave the flag off to run on the logging sender.");
        }
        this.json = json;
        this.calls = calls;
        this.from = Map.of("address", props.fromAddress(),
                "name", isBlank(props.fromName()) ? "Draazy" : props.fromName());
        // The Zoho console shows the token with its scheme prefix; accept it pasted either way.
        String key = props.apiKey().strip();
        String authorization = key.startsWith(AUTH_SCHEME) ? key : AUTH_SCHEME + key;

        JdkClientHttpRequestFactory timeouts = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build());
        timeouts.setReadTimeout(RESPONSE_TIMEOUT);
        this.http = RestClient.builder()
                .requestFactory(timeouts)
                .baseUrl(props.baseUrl().replaceAll("/+$", ""))
                .defaultHeader("Authorization", authorization)
                .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader("Accept", MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    @Override
    public void send(String to, String subject, String text) {
        Map<String, Object> body = Map.of(
                "from", from,
                "to", List.of(Map.of("email_address", Map.of("address", to))),
                "subject", subject,
                "textbody", text,
                "track_opens", false,
                "track_clicks", false);
        long started = System.nanoTime();
        String failure = null;
        try {
            http.post().uri("/v1.1/email").body(body).retrieve().toBodilessEntity();
        } catch (RestClientResponseException e) {
            failure = "http " + e.getStatusCode().value() + " " + describe(e.getResponseBodyAsString());
            log.warn("ZeptoMail send to {} failed: {}", EmailSender.maskAddress(to), failure);
        } catch (RestClientException e) {
            failure = ProviderCalls.diagnosis(e);
            log.warn("ZeptoMail send to {} failed", EmailSender.maskAddress(to), e);
        }
        calls.record(ProviderCalls.ZEPTOMAIL, OPERATION,
                failure == null ? ProviderCalls.Outcome.OK : ProviderCalls.Outcome.FAILED,
                to, subject, failure, (int) ((System.nanoTime() - started) / 1_000_000L));
    }

    /** Error codes only: Zoho's free-text messages can echo the recipient address. */
    private String describe(String responseBody) {
        try {
            JsonNode error = json.readTree(responseBody).path("error");
            if (error.isMissingNode()) {
                return "unrecognised body (" + responseBody.length() + " chars)";
            }
            StringBuilder codes = new StringBuilder("code=").append(error.path("code").asString("?"));
            error.path("details").forEach(d -> codes.append(' ').append(d.path("code").asString("?")));
            return codes.toString();
        } catch (Exception parseFailure) {
            return "unparseable body (" + responseBody.length() + " chars)";
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
