package com.draazy.api.admin;

import java.time.Instant;
import java.util.UUID;

public record AdminProviderCall(
        UUID id,
        String provider,
        String operation,
        String outcome,
        String recipient,
        String reference,
        String detail,
        Integer durationMs,
        Instant createdAt) {
}
