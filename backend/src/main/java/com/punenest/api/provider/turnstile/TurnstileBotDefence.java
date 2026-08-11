package com.punenest.api.provider.turnstile;

import com.punenest.api.security.BotDefence;
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

/**
 * Cloudflare Turnstile, the real bot defence (tech-debt D130, ADR-015).
 *
 * <p>Only constructed when {@code punenest.security.turnstile.enabled=true}. With the flag off —
 * which is the default, and what every developer machine and the test suite run — this bean does not
 * exist at all and {@code NoopBotDefence} is wired in its place. That is stronger than a runtime
 * {@code if}: there is no code path, live or accidental, that reaches Cloudflare on an unconfigured
 * install, and no secret is required to boot.
 *
 * <p><strong>No new dependency.</strong> Verification is one form-encoded POST, so this follows the
 * shape already established by {@code CashfreeClient}: Spring's {@code RestClient} over a
 * {@code SimpleClientHttpRequestFactory} with explicit timeouts. Pulling in an SDK for a single HTTP
 * call would cost more than it saves, and this build resolves offline — a new artifact is a build
 * that stops working on someone else's machine.
 *
 * <p><strong>Timeouts are not optional here.</strong> The default for most HTTP clients is "wait
 * forever". This call sits in a servlet filter on an unauthenticated endpoint, so a Cloudflare that
 * accepts connections and never answers would pin one request thread per attempt until the pool is
 * exhausted — an attacker-triggerable outage delivered by the anti-abuse control itself. Three
 * seconds to connect and five to read is far beyond a healthy response and far below a thread being
 * worth holding.
 *
 * <p><strong>Every failure is a rejection.</strong> A transport error, a non-2xx, an unparseable
 * body and an explicit {@code success: false} all return {@code false}, and the request is refused.
 * See {@link BotDefence} for why this direction is chosen even though it means a Cloudflare outage
 * costs real users a form submission: the opposite choice hands anyone who can break the
 * verification call a switch that turns the defence off, silently, while the forms keep working.
 */
@Component
@ConditionalOnProperty(prefix = "punenest.security.turnstile", name = "enabled",
        havingValue = "true")
public class TurnstileBotDefence implements BotDefence {

    private static final Logger log = LoggerFactory.getLogger(TurnstileBotDefence.class);

    /** Cloudflare's verification endpoint. Overridable only so a test can point it at a local one. */
    public static final String DEFAULT_VERIFY_URL =
            "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private final RestClient http;
    private final String secretKey;

    public TurnstileBotDefence(
            @Value("${punenest.security.turnstile.secret-key:}") String secretKey,
            @Value("${punenest.security.turnstile.verify-url:" + DEFAULT_VERIFY_URL + "}")
            String verifyUrl,
            @Value("${punenest.security.turnstile.connect-timeout-seconds:3}") long connectSeconds,
            @Value("${punenest.security.turnstile.read-timeout-seconds:5}") long readSeconds) {
        if (secretKey == null || secretKey.isBlank()) {
            // Refusing to start is the only safe answer. The alternatives are both worse: verifying
            // every token against an empty secret means Cloudflare rejects all of them, so the
            // platform's public forms are 100% broken; silently falling back to the no-op means the
            // operator believes the defence is on when it is off, which is the failure mode this
            // whole debt is about. A boot failure names the problem at the moment someone can fix it.
            throw new IllegalStateException(
                    "punenest.security.turnstile.enabled=true but secret-key is not set "
                            + "(TURNSTILE_SECRET_KEY). Either supply the secret or leave the flag "
                            + "off to run without a challenge.");
        }
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
            // Corroborating only. Cloudflare treats a mismatch as one signal among several, and it
            // is sent as a best effort: behind a proxy this is the proxy's address, which must not
            // by itself fail a verification for every user on the platform.
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
            // Read as an Object and compared, rather than cast: a body whose `success` is a string,
            // a number or absent must be a refusal, not a ClassCastException escaping a filter as a
            // 500 on a public endpoint.
            boolean ok = Boolean.TRUE.equals(body.get("success"));
            if (!ok) {
                // Cloudflare's error codes describe our configuration (a bad secret, a token already
                // spent, an expired challenge) and are logged for the operator. They are never
                // returned: see BotDefenceFilter#reject for why the caller learns nothing.
                log.warn("Turnstile rejected a token: {}", body.get("error-codes"));
            }
            return ok;
        } catch (RuntimeException e) {
            // Deliberately broad — RestClientException is one of these, and so is anything Jackson
            // throws on a body that is not the JSON it was promised.
            // The point of this catch is that *no* failure of the verification
            // call may reach the filter as an exception, because an exception there would become a
            // 500 — and a 500 is not a rejection, it is an error page that some clients retry and
            // some operators mute. Every path out of this method is a boolean decision.
            log.error("Turnstile verification failed; refusing the request", e);
            return false;
        }
    }
}
