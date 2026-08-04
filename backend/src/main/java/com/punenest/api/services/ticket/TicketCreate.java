package com.punenest.api.services.ticket;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code TicketCreate}.
 *
 * <p>Four fields of the {@code Ticket} schema are absent and each absence is deliberate:
 * {@code status} starts at {@code open}, {@code assigneeId} is ops' to set, and {@code service} and
 * {@code value} are ops' commercial annotations — a client that could set its own deal value would
 * be writing the pipeline report.
 *
 * @param body maps to {@code tickets.detail}; the contract calls it {@code body}
 */
public record TicketCreate(
        @NotBlank @Size(max = 200) String subject,
        @Size(max = 32) String team,
        @Size(max = 16) String priority,
        @Size(max = 64) String propertyId,
        @Size(max = 4000) String body) {
}
