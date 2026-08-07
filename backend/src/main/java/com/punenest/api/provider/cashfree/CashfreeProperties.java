package com.punenest.api.provider.cashfree;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cashfree credentials and the master on/off switch for every Cashfree-backed provider
 * (KYC today, the payment rail in slice 6).
 *
 * <p><strong>Why a flag rather than the {@code prod} profile.</strong> The seams were originally
 * split {@code @Profile("!prod")} / {@code @Profile("prod")}, which conflates two independent
 * questions: <em>which environment is this</em> and <em>do we have vendor credentials</em>. That
 * coupling is wrong in both directions — a production deployment could not be brought up on mocks
 * during an outage or a soft launch, and a developer holding real sandbox keys could never exercise
 * the real client without pretending to be production. Since PuneNest has no Cashfree account yet
 * but the integration has to be written and reviewable now, the two must come apart.
 *
 * <p>Default is <strong>off</strong>, deliberately. A missing configuration value should land on the
 * behaviour that cannot cost money or leak PII, and "silently started calling a payment vendor
 * because a property was unset" is not a failure mode worth leaving open. Turning it on requires
 * saying so.
 *
 * <p>Credentials are environment-supplied and have <strong>no committed default</strong>: unlike the
 * webhook secret there is no demo value that could stand in, and a blank key would produce
 * confusing 401s from the vendor rather than an obvious local misconfiguration. {@link
 * CashfreeClient} therefore refuses to construct when the flag is on and either key is missing, so
 * the boot fails at startup rather than at the first user's KYC attempt.
 *
 * @param enabled   when {@code false} (the default) the mock providers are wired and no external
 *                  call is ever made
 * @param baseUrl   {@code https://sandbox.cashfree.com} for test keys, {@code https://api.cashfree.com}
 *                  for live ones — the keys and the host must match or every call 401s
 */
@ConfigurationProperties("punenest.providers.cashfree")
public record CashfreeProperties(
        boolean enabled,
        String baseUrl,
        String appId,
        String secretKey) {
}
