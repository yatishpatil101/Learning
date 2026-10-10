package com.draazy.api.provider.turnstile;

import com.draazy.api.security.BotDefence;
import java.time.Duration;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/** Only built when enabled, so an unconfigured install has no path to Cloudflare. Every failure is a
 * rejection: failing open would hand anyone who can break the call a switch that turns the defence off. */
@Component
@ConditionalOnProperty(prefix = "draazy.security.turnstile", name = "enabled",
        havingValue = "true")
public class TurnstileBotDefence implements BotDefence {

    private static final Logger log = LoggerFactory.getLogger(TurnstileBotDefence.class);

    /** Cloudflare's verification endpoint. Overridable only so a test can point it at a local one. */
    public static final String DEFAULT_VERIFY_URL =
            "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private final RestClient http;
    private final String secretKey;

    public TurnstileBotDefence(
            @Value("${draazy.security.turnstile.secret-key:}") String secretKey,
            @Value("${draazy.security.turnstile.verify-url:" + DEFAULT_VERIFY_URL + "}")
            String verifyUrl,
            @Value("${draazy.security.turnstile.connect-timeout-seconds:3}") long connectSeconds,
            @Value("${draazy.security.turnstile.read-timeout-seconds:5}") long readSeconds) {
        if (secretKey == null || secretKey.isBlank()) {
            // Fail at boot: an empty secret breaks every form, and a silent no-op fakes a live defence.
            throw new IllegalStateException(
                    "draazy.security.turnstile.enabled=true but secret-key is not set "
                            + "(TURNSTILE_SECRET_KEY). Either supply the secret or leave the flag "
                            + "off to run without a challenge.");
        }
        // Explicit timeouts: this runs on an unauthenticated endpoint, and a hung Cloudflare would pin threads.
        SimpleClientHttpRequestFactory timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(connectSeconds));
        timeouts.setReadTimeout(Duration.ofSeconds(readSeconds));

        this.secretKey = secretKey;
        this.http = RestClient.builder()
                .requestFactory(timeouts)
                .baseUrl(verifyUrl)
                .build();
    }

    /** Always {@code true}: this bean only exists when the challenge is switched on. */
    @Override
    public boolean enforced() {
        return true;
    }

    @Override
    public boolean verify(String token, String remoteIp) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("secret", secretKey);
        form.add("response", token);
        if (remoteIp != null && !remoteIp.isBlank()) {
            // Corroborating only: behind a proxy this is the proxy's address, which must not fail everyone.
            form.add("remoteip", remoteIp);
        }
        try {
            Map<?, ?> body = http.post()
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .body(Map.class);
            if (body == null) {
                log.warn("Turnstile returned an empty body; refusing the request");
                return false;
            }
            // Compared, not cast: a non-boolean `success` must be a refusal, not a 500 from a ClassCastException.
            boolean ok = Boolean.TRUE.equals(body.get("success"));
            if (!ok) {
                // Error codes describe our configuration: logged, never returned (BotDefenceFilter#REFUSAL).
                log.warn("Turnstile rejected a token: {}", body.get("error-codes"));
            }
            return ok;
        } catch (RuntimeException e) {
            // Deliberately broad: an exception would reach the filter as a 500, which some clients retry
            // and some operators mute. Every path out of this method is a boolean decision.
            log.error("Turnstile verification failed; refusing the request", e);
            return false;
        }
    }
}
