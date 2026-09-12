package com.draazy.api.provider.whatsapp;

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

/**
 * The single HTTP door to Meta's WhatsApp Cloud API. Both WhatsApp-backed providers — the login OTP
 * sender today and the ADR-010 notification templates later — go through here, so the credential
 * handling, the timeouts, the version pinning and the "never let a vendor error string reach a user"
 * rule are written once. Same shape as {@code CashfreeClient}, for the same reasons.
 *
 * <p>Only constructed when {@code draazy.providers.whatsapp.enabled=true}. With the flag off this
 * bean does not exist at all, which is stronger than a runtime {@code if}: there is no code path,
 * live or accidental, that reaches Meta. The dev mock is wired in its place.
 *
 * <p><strong>The path is a parameter, not a constant.</strong> Sending goes to
 * {@code /<PHONE_NUMBER_ID>/messages} while template management goes to
 * {@code /<WABA_ID>/message_templates} — two different IDs on the same host. Baking either into
 * this class would guarantee the other call site is wrong, so the base URL stops at the version and
 * each caller names the node it addresses.
 *
 * <p><strong>The call is bounded by a deadline, not by a read timeout.</strong> The obvious
 * {@code SimpleClientHttpRequestFactory} is {@code HttpURLConnection} underneath, whose read
 * timeout bounds a <em>single socket read</em> and restarts on every byte received. A peer that
 * dribbles one byte every few seconds is therefore never cut off, and "3s + 6s" is not a bound on
 * anything — the worst case is unbounded. That matters more here than anywhere else in the app: the
 * send runs on the request thread of {@code POST /auth/login}, holding one of a five-connection
 * production pool, so an unbounded call is an unauthenticated route that can stall every endpoint.
 * {@code CashfreeClient} still has the older shape; it is the same weakness, but it sits behind an
 * authenticated checkout rather than in front of the login screen.
 *
 * <p>Two incidental consequences of the swap, both fine, both worth knowing before reading a
 * production incident backwards: the JDK client negotiates <strong>HTTP/2</strong> via ALPN where
 * the old one was HTTP/1.1 (Graph supports it), and responses arrive on the client's own executor.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.whatsapp", name = "enabled", havingValue = "true")
public class WhatsAppClient {

    /** Ceiling on establishing the TCP+TLS connection to Meta. */
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    /**
     * Ceiling on the whole exchange, <em>including</em> connecting — the clock starts when the
     * request is handed to the client, so this does not add to {@link #CONNECT_TIMEOUT}; the worst
     * case is this number, not the sum. Deliberately short: Meta answers a send in well under a
     * second, and every second past that is a second a login request thread and a database
     * connection are both parked on a third party.
     */
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
        // Spring installs this as a CompletableFuture deadline around sendAsync and around the body
        // stream, so it covers connect, headers and body - not HttpRequest.timeout, which stops at
        // the headers.
        timeouts.setReadTimeout(RESPONSE_TIMEOUT);

        this.http = RestClient.builder()
                .requestFactory(timeouts)
                .baseUrl(props.baseUrl() + "/" + props.apiVersion())
                .defaultHeader("Authorization", "Bearer " + props.accessToken())
                .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /**
     * POST a JSON body to a Graph node below the pinned version and discard the reply.
     *
     * <p><strong>The response body is deliberately not deserialized.</strong> Meta answers a send
     * with a {@code wamid}, which is only useful to correlate a later status webhook — and ADR-020
     * chose WhatsApp-only delivery with no fallback, so there is no consumer for that correlation.
     * Parsing a reply nobody reads would only add a second way for a <em>successful</em> send to
     * raise an exception, on the path that decides whether the user is told their code is on its
     * way.
     *
     * @param path path below {@code <baseUrl>/<apiVersion>}, e.g. {@code /1234567890/messages}
     * @param body request payload, serialized as JSON
     * @throws WhatsAppException on any transport failure or non-2xx status. Meta's own message is
     *                           logged, never returned: it names our phone number ID and template,
     *                           and neither belongs in an API response.
     */
    public void post(String path, Object body) {
        try {
            http.post()
                    .uri(path)
                    .body(body)
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException e) {
            log.error("WhatsApp POST {} failed: {} {}", path, e.getStatusCode(),
                    describe(e.getResponseBodyAsString()));
            // The cause is deliberately dropped. RestClientResponseException embeds several hundred
            // characters of the response body in its own getMessage(), so handing it on as a cause
            // would let the catch-all handler log the raw envelope a second time, inside a stack
            // trace nobody was thinking about — undoing the redaction two lines above.
            throw new WhatsAppException("WhatsApp call failed: " + path + " (" + e.getStatusCode() + ")");
        } catch (RestClientException e) {
            log.error("WhatsApp POST {} failed", path, e);
            throw new WhatsAppException("WhatsApp call failed: " + path, e);
        }
    }

    /**
     * Reduce Meta's error envelope to the identifiers that diagnose it, discarding the rest.
     *
     * <p><strong>The rest is not safe to log.</strong> {@code error.message},
     * {@code error.error_user_msg} and {@code error.error_data.details} are vendor-controlled free
     * text, and several send failures name the recipient — whose full mobile this codebase treats as
     * PII strictly enough to keep a masking kernel for it ({@code common.trust.MobileMask}).
     * Whether that free text can also echo the submitted OTP is a contract Meta does not publish, so
     * it is treated as unproven rather than as safe.
     *
     * <p>What survives is enough: the numeric code <em>is</em> the diagnosis. 131030 is "recipient is
     * not on the test number's allow-list", 132001 is "no template by that name and language",
     * 133010 is "the token's phone number is not registered". {@code fbtrace_id} is what Meta support
     * asks for. If the body is not the envelope we expect — an HTML error page from a proxy, say —
     * its shape is reported rather than its content, because an unrecognised body is exactly the
     * case where nobody has checked what is in it.
     */
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

    /**
     * An upstream WhatsApp failure.
     *
     * <p>Deliberately <em>not</em> part of the {@code common.error.ApiException} hierarchy, for the
     * reason given on {@code CashfreeClient.CashfreeException}: those carry a status code because
     * they describe something the caller did, and Meta being down or rejecting our token is not the
     * user's mistake. A 4xx here would tell someone to re-check a mobile number that was never the
     * problem. Falling through to the handler's generic 500 is the honest answer.
     */
    public static class WhatsAppException extends RuntimeException {
        WhatsAppException(String message) {
            super(message);
        }

        WhatsAppException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
