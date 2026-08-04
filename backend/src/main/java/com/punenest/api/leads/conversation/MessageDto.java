package com.punenest.api.leads.conversation;

import java.time.Instant;

/** Contract {@code Message} — one message in a thread. {@code author} is a display name. */
public record MessageDto(
        String id,
        String author,
        String authorRole,
        String body,
        Instant createdAt) {
}
