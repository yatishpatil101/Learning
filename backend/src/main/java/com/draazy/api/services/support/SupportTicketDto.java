package com.draazy.api.services.support;

import java.time.Instant;
import java.util.List;

public record SupportTicketDto(
        String id,
        String subject,
        String category,
        String status,
        boolean unread,
        List<MessageDto> messages,
        Instant createdAt) {
}
