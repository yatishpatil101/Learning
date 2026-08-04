package com.punenest.api.services.request;

import java.time.Instant;

/**
 * Contract schema {@code Message}.
 *
 * @param author     display name; {@code null} for a message whose author has since been removed
 * @param authorRole {@code buyer|owner|staff|admin}, captured at write time
 */
public record MessageDto(
        String id,
        String author,
        String authorRole,
        String body,
        Instant createdAt) {
}
