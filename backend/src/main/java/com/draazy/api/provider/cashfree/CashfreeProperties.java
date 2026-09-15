package com.draazy.api.provider.cashfree;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Cashfree credentials and the on/off flag for every Cashfree-backed provider; off by default and
 * with no committed credential default. docs/system/profiles.md#vendor-flags.
 */
@ConfigurationProperties("draazy.providers.cashfree")
public record CashfreeProperties(
        boolean enabled,
        String baseUrl,
        String appId,
        String secretKey) {
}
