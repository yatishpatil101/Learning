package com.draazy.api.services.support;

import java.time.Instant;

/** Separate from {@code services.request.MessageDto} and {@code leads.conversation.MessageDto}: they render
 * alike today but must be free to diverge. */
public record MessageDto(
        String id,
        String author,
        String authorRole,
        String body,
        Instant createdAt) {
}
