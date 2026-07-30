package com.punenest.api.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * JWT configuration. The secret is env-driven (never committed for real environments); TTLs default
 * per ADR-008 (15-min access, 30-day refresh) but stay overridable.
 *
 * @param secret     HS256 signing key; must be ≥ 32 bytes
 * @param accessTtl  access-token lifetime
 * @param refreshTtl refresh-token lifetime
 */
@ConfigurationProperties(prefix = "punenest.security.jwt")
public record JwtProperties(
        String secret,
        @DefaultValue("15m") Duration accessTtl,
        @DefaultValue("30d") Duration refreshTtl) {
}
