package com.punenest.api.services.ticket;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

/**
 * Contract schema {@code TicketCreate}.
 *
 * <p>Three fields of the {@code Ticket} schema are absent and each absence is deliberate:
 * {@code status} starts at {@code open}, {@code assigneeId} is ops' to set, and {@code service} and
 * {@code value} are ops' commercial annotations — a client that could set its own deal value would
 * be writing the pipeline report.
 *
 * <p><strong>Why {@code quotedValue} is here anyway (D3).</strong> That reasoning is right about
 * {@code value} and was, for a while, read as a rule about money in general, which left the Move-in
 * Pack booking with nowhere to put a total the customer had assembled line by line and accepted —
 * so the lead was dropped rather than filed with a number nobody could write down. But a quote and
 * a deal value are two different facts: the quote is what was agreed before ops saw the job, the
 * value is what the desk expects to bill after. When they disagree — the pack was priced for a
 * 2 BHK and the flat is a 4 BHK — the disagreement is the useful signal, and a single column can
 * only record it by destroying the number that made it visible. Letting the client state what it
 * charged is not the same as letting it state what the deal is worth.
 *
 * <p>It is write-once by construction: {@link Ticket#getQuotedValue()} is {@code updatable = false}
 * and {@link TicketUpdate} has no component for it. A quote is a fact about a moment, and an
 * editable quote is evidence of nothing.
 *
 * @param body        maps to {@code tickets.detail}; the contract calls it {@code body}
 * @param quotedValue whole rupees, like every other money field in this codebase — see the note on
 *                    {@code Ticket.value}, whose "paise" Javadoc was wrong. Optional: most tickets
 *                    are raised from an unpriced form, and {@code null} means "nobody quoted
 *                    anything", which is a different claim from zero ("quoted, free of charge").
 */
public record TicketCreate(
        @NotBlank @Size(max = 200) String subject,
        @Size(max = 32) String team,
        @Size(max = 16) String priority,
        @Size(max = 64) String propertyId,
        @Size(max = 4000) String body,
        @PositiveOrZero Long quotedValue) {
}
