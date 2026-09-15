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
 * The single HTTP door to Cashfree, so credentials, timeouts, version pinning and the "no vendor
 * error string reaches a user" rule are written once. docs/system/profiles.md#vendor-flags.
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
     * POST a JSON body to Cashfree and deserialize the reply. {@code apiVersion} is the version this
     * call site was written against. The vendor's own error message is logged, never returned.
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
     * An upstream Cashfree failure. Deliberately outside the {@code ApiException} hierarchy: a
     * vendor outage is not the caller's mistake, so the generic 500 is the honest answer.
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
