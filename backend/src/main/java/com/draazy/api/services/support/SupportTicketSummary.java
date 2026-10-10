package com.draazy.api.services.support;

import java.time.Instant;

public record SupportTicketSummary(
        String id,
        String subject,
        String category,
        String status,
        boolean unread,
        LastMessage lastMessage,
        Instant createdAt) {

    /** {@code body} is cut to a one-line preview. */
    public record LastMessage(String authorRole, String body, Instant createdAt) {
    }
}