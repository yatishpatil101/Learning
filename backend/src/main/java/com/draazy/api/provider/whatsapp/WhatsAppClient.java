package com.draazy.api.provider.whatsapp;

import com.draazy.api.provider.ProviderCalls;
import java.net.http.HttpClient;
import java.time.Duration;
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

/** The call is bounded by a whole-exchange deadline, not a read timeout, which restarts on every byte received;
 * the login thread holds one of five pool connections, so a dribbling peer could stall the app. */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled", havingValue = "true")
public class WhatsAppClient {

    /** Ceiling on establishing the TCP+TLS connection to Meta. */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    /** Ceiling on the whole exchange including connecting, so the worst case is this number, not the sum;
     * short because a login thread and a database connection are parked on a third party meanwhile. */
    private static final Duration RESPONSE_TIMEOUT = Duration.ofSeconds(5);

    private static final Logger log = LoggerFactory.getLogger(WhatsAppClient.class);

    private final RestClient http;
    private final ObjectMapper json;

    WhatsAppClient(WhatsAppProperties props, ObjectMapper json) {
        this.json = json;
        if (isBlank(props.accessToken()) || isBlank(props.phoneNumberId())) {
            throw new IllegalStateException(
                    "draazy.providers.whatsapp.enabled=true but access-token/phone-number-id are "
                            + "not set (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID). Either "
                            + "supply them or leave the flag off to run on the mock sender.");
        }
        if (isBlank(props.apiVersion())) {
            throw new IllegalStateException(
                    "draazy.providers.whatsapp.api-version is blank. Pin it explicitly (e.g. v23.0) "
                            + "— an unversioned Graph call is not a stable contract.");
        }
        if (isBlank(props.baseUrl())) {
            throw new IllegalStateException(
                    "draazy.providers.whatsapp.base-url is blank (WHATSAPP_BASE_URL). Left unset it "
                            + "would build the base URL 'null/" + props.apiVersion() + "', which "
                            + "fails as an unresolvable URI on someone's first login rather than "
                            + "here.");
        }
        JdkClientHttpRequestFactory timeouts = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build());
        // Spring installs this as a deadline around sendAsync and the body stream, covering connect, headers
        // and body, unlike HttpRequest.timeout, which stops at the headers.
        timeouts.setReadTimeout(RESPONSE_TIMEOUT);

        this.http = RestClient.builder()
                .requestFactory(timeouts)
                .baseUrl(props.baseUrl() + "/" + props.apiVersion())
                .defaultHeader("Authorization", "Bearer " + props.accessToken())
                .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /** The reply is not deserialized: nothing consumes the wamid, and parsing could make a successful send throw.
     * Meta's own error text is logged, never returned, as it names our phone number ID and template. */
    public void post(String path, Object body) {
        try {
            http.post()
                    .uri(path)
                    .body(body)
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException e) {
            String diagnosis = "http " + e.getStatusCode().value() + " " + describe(e.getResponseBodyAsString());
            log.error("WhatsApp POST {} failed: {}", path, diagnosis);
            // The cause is dropped: RestClientResponseException embeds the response body in getMessage(),
            // so passing it on would let the catch-all handler log the raw envelope again.
            throw new WhatsAppException("WhatsApp call failed: " + path + " (" + e.getStatusCode() + ")",
                    diagnosis);
        } catch (RestClientException e) {
            log.error("WhatsApp POST {} failed", path, e);
            throw new WhatsAppException("WhatsApp call failed: " + path, e);
        }
    }

    /** Only identifiers are logged: Meta's free-text error fields can name the recipient's mobile (PII)
     * and may echo the submitted OTP, which Meta does not publish a contract on. */
    private String describe(String responseBody) {
        try {
            JsonNode error = json.readTree(responseBody).path("error");
            if (error.isMissingNode()) {
                return "unrecognised body (" + responseBody.length() + " chars, no 'error' node)";
            }
            return "code=" + error.path("code").asString("?")
                    + " subcode=" + error.path("error_subcode").asString("-")
                    + " type=" + error.path("type").asString("?")
                    + " fbtrace_id=" + error.path("fbtrace_id").asString("-");
        } catch (Exception parseFailure) {
            return "unparseable body (" + responseBody.length() + " chars)";
        }
    }

    /** Not an {@code ApiException}: those carry a 4xx for caller mistakes, and Meta being down is not the user's,
     * so it falls through to the generic 500. */
    public static class WhatsAppException extends RuntimeException implements ProviderCalls.Diagnosed {
        private final String diagnosis;

        WhatsAppException(String message, String diagnosis) {
            super(message);
            this.diagnosis = diagnosis;
        }

        WhatsAppException(String message, Throwable cause) {
            super(message, cause);
            this.diagnosis = ProviderCalls.diagnosis(cause);
        }

        @Override
        public String diagnosis() {
            return diagnosis;
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
