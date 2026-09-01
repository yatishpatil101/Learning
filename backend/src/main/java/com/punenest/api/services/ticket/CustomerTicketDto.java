package com.punenest.api.services.ticket;

import java.time.Instant;

/**
 * Contract schema {@code CustomerTicket} — a ticket as its <strong>raiser</strong> may see it (debt
 * D47).
 *
 * <p><strong>Why a second record rather than a filter.</strong> {@link TicketDto} carries
 * {@code notes}, which the contract itself labels "Internal staff notes", and it was handed to the
 * customer on the {@code POST /tickets} 201. That was safe only by arithmetic: a ticket created and
 * serialized inside one transaction cannot have a note yet, so the list came back empty every time.
 * Nothing enforced it. The first ops feature that wrote a note on the way in — a triage rule, an
 * auto-assignment audit line, a "raised via web" stamp — would have shipped the leak with no code
 * change on this path and nothing for a reviewer to catch.
 *
 * <p>Splitting the type moves that from a runtime coincidence to a compile-time fact: there is no
 * {@code notes} component here, so no future edit to the mapper, the service or the entity can put
 * one on the wire. The same reasoning the catalogue uses for {@code PropertySummary}, which omits
 * owner contact rather than nulling it.
 *
 * <p><strong>{@code assignee} is deliberately kept.</strong> It is a staff display name, and the
 * contract marks it {@code readOnly} rather than internal — telling a customer who is handling their
 * request is support, not disclosure. {@code notes} is the only field the contract calls internal,
 * and it is the only one dropped; drawing the line anywhere else would be this file inventing a
 * policy the contract does not state.
 *
 * @param assignee the staff member's display name, derived — assignment is by id (spec fix S42)
 * @param mobile   the raiser's own number, echoed back to them. Not a disclosure: it is the value
 *                 they authenticated with.
 * @param quotedValue what this customer accepted, echoed back for the same reason as {@code mobile}
 *                 — it is their own number, and a booking confirmation that cannot state the price
 *                 booked is not a confirmation. {@code value}, by contrast, stays because the
 *                 contract already places it on this schema; it is null on a fresh ticket and only
 *                 ops ever write it.
 */
public record CustomerTicketDto(
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
        Long quotedValue,
        String detail,
        Instant createdAt) {
}
