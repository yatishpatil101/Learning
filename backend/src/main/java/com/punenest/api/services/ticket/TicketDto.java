package com.punenest.api.services.ticket;

import java.time.Instant;
import java.util.List;

/**
 * Contract schema {@code Ticket} — the <strong>staff</strong> view of the ops board.
 *
 * <p>{@code notes} are internal, and every reader of this DTO is now ops: {@code GET /tickets} and
 * {@code PATCH /tickets/{id}} are both behind a staff/admin guard. The one customer-facing response
 * that used to be this type, the {@code POST /tickets} 201, returns {@link CustomerTicketDto}
 * instead (debt D47) — a type with no {@code notes} component at all, so the guarantee is the
 * compiler's rather than the accident of a fresh ticket having none.
 *
 * <p>Anything added to this record is staff-only by construction. If a field belongs to the raiser
 * too, put it on both records rather than widening the audience of this one.
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
