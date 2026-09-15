package com.draazy.api.provider.cashfree;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Off by default, with no committed credential default. Blank {@code notifyUrl} means "use the
 * dashboard's", which a local tunnel cannot: its address changes on every restart.
 */
@ConfigurationProperties("draazy.providers.cashfree")
public record CashfreeProperties(
        boolean enabled,
        String baseUrl,
        String appId,
        String secretKey,
        String notifyUrl) {
}
