package com.draazy.api.provider.cashfree;

import java.time.Duration;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * The single HTTP door to Cashfree. Both Cashfree-backed providers — {@link CashfreeKycProvider}
 * today and the payment rail in slice 6 — go through here, so the credential handling, the timeouts,
 * the version pinning and the "never let a vendor error string reach a user" rule are written once.
 *
 * <p>Only constructed when {@code draazy.providers.cashfree.enabled=true}. With the flag off this
 * bean does not exist at all, which is stronger than a runtime {@code if}: there is no code path,
 * live or accidental, that reaches a vendor. The mock providers are wired in its place.
 *
 * <p><strong>The API version is a parameter, not a constant.</strong> Cashfree versions its products
 * separately — Payment Gateway is on {@code 2025-01-01} while Secure ID is on {@code 2024-12-01} —
 * and pinning one of them here would silently send the wrong version for the other. Each caller
 * declares the version it was written against, so an upgrade is a visible edit at the call site
 * rather than a shared constant nobody dares move.
 *
 * <p><strong>Timeouts are set explicitly.</strong> The default for most HTTP clients is "wait
 * forever", which turns a vendor slowdown into exhausted request threads and takes Draazy down
 * with them. A KYC start that has not answered in ten seconds has failed as far as the user is
 * concerned.
 */
@Component
@ConditionalOnProperty(prefix = "draazy.providers.cashfree", name = "enabled", havingValue = "true")
public class CashfreeClient {

    private static final Logger log = LoggerFactory.getLogger(CashfreeClient.class);

    private final RestClient http;

    CashfreeClient(CashfreeProperties props) {
        if (isBlank(props.appId()) || isBlank(props.secretKey())) {
            throw new IllegalStateException(
                    "draazy.providers.cashfree.enabled=true but app-id/secret-key are not set "
                            + "(CASHFREE_APP_ID / CASHFREE_SECRET_KEY). Either supply the keys or "
                            + "leave the flag off to run on the mock providers.");
        }
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(5));
        timeouts.setReadTimeout(Duration.ofSeconds(10));

        this.http = RestClient.builder()
                .requestFactory(timeouts)
                .baseUrl(props.baseUrl())
                .defaultHeader("X-Client-Id", props.appId())
                .defaultHeader("X-Client-Secret", props.secretKey())
                .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /**
     * POST a JSON body to Cashfree and deserialize the reply.
     *
     * @param path         path below the base URL, e.g. {@code /verification/digilocker}
     * @param apiVersion   value for {@code x-api-version} — the version <em>this call site</em> was
     *                     written against
     * @param body         request payload, serialized as JSON
     * @param responseType expected reply shape
     * @throws CashfreeException on any transport failure or non-2xx status. The vendor's own message
     *                           is logged, never returned: it can quote the request back (an account
     *                           number, a mobile) and it names our merchant configuration, neither of
     *                           which belongs in an API response.
     */
    public <T> T post(String path, String apiVersion, Object body, Class<T> responseType) {
        try {
            return http.post()
                    .uri(path)
                    .header("x-api-version", apiVersion)
                    .body(body)
                    .retrieve()
                    .body(responseType);
        } catch (RestClientException e) {
            log.error("Cashfree POST {} failed", path, e);
            throw new CashfreeException("Cashfree call failed: " + path, e);
        }
    }

    /**
     * GET from Cashfree.
     *
     * @see #post(String, String, Object, Class)
     */
    public <T> T get(String path, String apiVersion, Class<T> responseType) {
        try {
            return http.get()
                    .uri(path)
                    .header("x-api-version", apiVersion)
                    .retrieve()
                    .body(responseType);
        } catch (RestClientException e) {
            log.error("Cashfree GET {} failed", path, e);
            throw new CashfreeException("Cashfree call failed: " + path, e);
        }
    }

    /**
     * An upstream Cashfree failure.
     *
     * <p>Deliberately <em>not</em> part of the {@code common.error.ApiException} hierarchy. Those
     * exceptions each carry a status code because they describe something the caller did; a vendor
     * being down or rejecting our merchant credentials is not the caller's mistake and must not be
     * reported as though it were — a 4xx here would send a user to re-check an Aadhaar number that
     * was never the problem. Falling through to the handler's generic 500 is the honest answer.
     */
    public static class CashfreeException extends RuntimeException {
        CashfreeException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /** Convenience for the small request bodies these APIs take. */
    static Map<String, Object> json(Object... keyValuePairs) {
        Map<String, Object> map = new java.util.LinkedHashMap<>();
        for (int i = 0; i < keyValuePairs.length; i += 2) {
            map.put((String) keyValuePairs[i], keyValuePairs[i + 1]);
        }
        return map;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
