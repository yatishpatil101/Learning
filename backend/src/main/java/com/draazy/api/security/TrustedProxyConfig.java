package com.draazy.api.security;

import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import org.apache.catalina.valves.RemoteIpValve;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Decides whose address {@code request.getRemoteAddr()} reports, from an explicit statement of the
 * deployment topology.
 *
 * <p><strong>Why this is application code and not two lines in a property file.</strong> The write
 * rate limiter keys anonymous callers on the client address. Behind a load balancer that address is
 * the balancer's, so every anonymous caller on the internet lands in one bucket and a single host
 * can exhaust the budget for everybody — the limiter becoming the outage it was added to prevent.
 * The fix is to let Tomcat rewrite the address from {@code X-Forwarded-For}, but <em>only</em> when
 * the immediate peer is a proxy we trust; trusting the header unconditionally is worse than
 * ignoring it, because then every caller picks their own bucket and the limit is advisory.
 *
 * <p>Expressed as {@code server.forward-headers-strategy} plus
 * {@code server.tomcat.remoteip.internal-proxies} in the prod profile, that fix had two ways to be
 * silently absent, both of which restore the original vulnerability with a green startup:
 *
 * <ul>
 *   <li><strong>A profile name is a magic string.</strong> A staging or preview deploy, or a
 *       production container whose profile is {@code production} rather than {@code prod}, simply
 *       never reads the file (the same trap already recorded as D147).</li>
 *   <li><strong>Boot's binder does not fail on an unresolved placeholder.</strong> Unlike
 *       {@code @Value}, {@code @ConfigurationProperties} binding resolves placeholders with
 *       {@code ignoreUnresolvablePlaceholders = true}, so an unset variable binds the literal text
 *       {@code ${INTERNAL_PROXIES}} rather than failing. Worse, the far more common
 *       declared-but-empty case ({@code INTERNAL_PROXIES=}) makes Tomcat set its trusted set to
 *       {@code null}, which installs the valve, trusts nothing, rewrites nothing and logs
 *       nothing.</li>
 * </ul>
 *
 * <p>So the topology is declared here instead, in a property with no default, read through
 * {@code @Value} — which does throw on an unresolved placeholder — and validated before the server
 * starts. Every deploy must say which of the two situations it is in. Saying it wrongly is still
 * possible; saying nothing is not.
 */
@Configuration
public class TrustedProxyConfig {

    private static final Logger log = LoggerFactory.getLogger(TrustedProxyConfig.class);

    /** The value that declares "nothing is in front of this app; the socket address is the client". */
    static final String NO_PROXY = "none";

    /**
     * Installs the address-rewriting valve, or deliberately does not.
     *
     * @param trustedProxies {@link #NO_PROXY}, or a Java regex matching the addresses of the
     *                       proxies immediately in front of this instance — the balancer's real
     *                       CIDR, never Tomcat's permissive default, which trusts all RFC1918 space
     *                       and so trusts anything that can reach the app over a private network
     */
    @Bean
    public WebServerFactoryCustomizer<TomcatServletWebServerFactory> remoteIpCustomizer(
            @Value("${draazy.security.trusted-proxies}") String trustedProxies) {

        String value = trustedProxies == null ? "" : trustedProxies.trim();
        if (value.isEmpty()) {
            throw new IllegalStateException(
                    "draazy.security.trusted-proxies must be set. Use 'none' if this instance is "
                            + "directly exposed, or a regex matching the load balancer's addresses. "
                            + "Leaving it blank would key every anonymous caller on the proxy's "
                            + "address, so one host could rate-limit the entire platform.");
        }

        if (NO_PROXY.equalsIgnoreCase(value)) {
            // Correct for local development and for an app on a public port. Logged at startup
            // because it is also what a misconfigured proxied deploy looks like, and this line plus
            // the one WriteRateLimitFilter emits when it actually sees a forwarded header are the
            // two halves of noticing that.
            log.info("Trusted proxies: none. Client addresses are read from the socket.");
            return factory -> { };
        }

        try {
            Pattern.compile(value);
        } catch (PatternSyntaxException e) {
            // Without this the same failure still stops the server, but as a PatternSyntaxException
            // thrown from deep inside a Tomcat customizer, which names neither the property nor the
            // environment variable behind it.
            throw new IllegalStateException(
                    "draazy.security.trusted-proxies is not a valid regex: " + value, e);
        }

        log.info("Trusted proxies: {}. Client addresses are read from X-Forwarded-For for peers "
                + "matching that pattern, and from the socket for everyone else.", value);
        return factory -> {
            RemoteIpValve valve = new RemoteIpValve();
            valve.setInternalProxies(value);
            factory.addEngineValves(valve);
        };
    }
}
