package com.draazy.api.admin;

import java.time.Instant;

/** One third party's recent traffic, read from {@code provider_call}. {@code live=false} means its mock is wired. */
public record AdminProviderHealth(
        String provider,
        boolean live,
        long ok24h,
        long failed24h,
        long skipped24h,
        long ok7d,
        long failed7d,
        Instant lastOkAt,
        Instant lastFailureAt,
        String lastFailureDetail) {
}
