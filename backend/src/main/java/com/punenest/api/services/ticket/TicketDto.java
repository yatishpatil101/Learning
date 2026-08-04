package com.punenest.api.services.ticket;

import java.time.Instant;
import java.util.List;

/**
 * Contract schema {@code Ticket}.
 *
 * <p>{@code notes} are internal, and so is every reader of this DTO except one: the customer who
 * just created a ticket gets it back from {@code POST /tickets}. A brand-new ticket has no notes, so
 * that response carries an empty list — but if the board ever gains a customer-facing read, the
 * notes have to be split off first. Recorded rather than guarded here, because a guard against a
 * caller that does not exist is a guard nobody maintains.
 *
 * @param assignee the staff member's display name, derived — assignment is by id (spec fix S42)
 * @param mobile   the requester's real number. Unmasked because every reader is either ops (who must
 *                 call them) or the requester themselves.
 */
public record TicketDto(
        String id,
        String subject,
        String team,
        String priority,
        String status,
        String propertyId,
        String assignee,
        String service,
        String customer,
        String mobile,
        Long value,
        String detail,
        List<Note> notes,
        Instant createdAt) {

    /** The inline note object of the {@code Ticket} schema. */
    public record Note(String by, String text, Instant at) {
    }
}
