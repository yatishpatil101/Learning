package com.draazy.api.services.ticket;

import java.time.Instant;

public record TicketRow(
        String id,
        String subject,
        String team,
        String priority,
        String status,
        String assignee,
        String service,
        String customer,
        String mobile,
        String detail,
        Instant createdAt) {
}
