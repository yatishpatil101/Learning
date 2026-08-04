package com.punenest.api.services.support;

import java.time.Instant;

/**
 * Contract schema {@code Message}.
 *
 * <p>A third copy of the same five fields, after {@code services.request.MessageDto} and
 * {@code leads.conversation.MessageDto}. That is deliberate: these are three unrelated conversation
 * surfaces that happen to render alike today, and a shared record would make any future divergence
 * (a support message needing an attachment, a chat message needing a delivery receipt) a change to
 * all three. Duplication here is cheaper than the coupling.
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
