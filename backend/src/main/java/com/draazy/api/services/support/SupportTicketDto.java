package com.draazy.api.services.support;

import java.time.Instant;
import java.util.List;

/**
 * Contract {@code SupportTicket}.
 *
 * <p>The thread is inline on the list as well as the detail — the contract declares no summary
 * shape, and a customer's ticket list grows with their own support history, so withholding it would
 * only cost a round trip. Contrast {@code leads.conversation.ConversationDto}, where the thread is
 * omitted from the inbox because a chat can run to hundreds of messages.
 *
 * @param unread whether a support reply is waiting for the ticket's owner — see {@link SupportTicket}
 */
public record SupportTicketDto(
        String id,
        String subject,
        String category,
        String status,
        boolean unread,
        List<MessageDto> messages,
        Instant createdAt) {
}
