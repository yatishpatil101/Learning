package com.punenest.api.services.ticket;

import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code TicketUpdate} (spec fix S42). Every field is optional — this is a PATCH,
 * and an absent field means "leave it".
 *
 * <p>{@code assigneeId} is a user id, not the display name the {@code Ticket} schema shows: two
 * staffers called Rohit cannot be told apart by name, and a rename would orphan the ticket. Passing
 * an explicit {@code null} does not unassign — JSON absence and JSON null are indistinguishable in a
 * record, and "unassign" is rare enough not to justify a wrapper type. Recorded as debt.
 */
public record TicketUpdate(
        @Size(max = 16) String status,
        @Size(max = 16) String priority,
        @Size(max = 64) String assigneeId,
        @Size(max = 32) String team) {
}
