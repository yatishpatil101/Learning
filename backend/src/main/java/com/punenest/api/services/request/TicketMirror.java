package com.punenest.api.services.request;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.services.ticket.Ticket;
import com.punenest.api.services.ticket.TicketRepository;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * The link from a service request back to the ops enquiry it came off (D45).
 *
 * <p>Its own collaborator rather than two more private methods on {@link ServiceRequestService},
 * because it is the only thing in that flow that reaches into another aggregate — a request needs
 * the {@code tickets} table for this and for nothing else. Keeping the reach here means the
 * dependency is visible in one constructor instead of hidden among a dozen, and the rule can be
 * exercised without opening a request.
 */
@Component
class TicketMirror {

    /**
     * The unique index behind the 409. Named so the collision can be told apart from the open-unpaid
     * cap, which lands on the same insert: two different rules answering with one another's message
     * is how a defect gets to look like a business rule.
     */
    static final String INDEX = "uq_service_requests_ticket";

    private final TicketRepository tickets;

    TicketMirror(TicketRepository tickets) {
        this.tickets = tickets;
    }

    /**
     * The ticket this request mirrors, validated, or {@code null} when it names none.
     *
     * <p><strong>It has to be the caller's own ticket.</strong> Anything weaker turns an optional
     * field into a way to staple your paperwork onto a stranger's enquiry — and the operator who
     * then opens the request would be shown two unrelated customers as one matter. A ticket that is
     * somebody else's reads as "no such ticket" rather than "forbidden", the platform's usual answer
     * for a resource whose existence is itself the private fact.
     *
     * <p>The desks are deliberately <em>not</em> required to agree. A ticket is re-teamed freely by
     * ops ({@code TicketService.update}) and this request's desk is fixed by its type, so demanding
     * a match would refuse a legitimate link the moment somebody moved the ticket. The link records
     * where the request came from; it does not route it.
     *
     * @throws BadRequestException if the id is malformed
     * @throws NotFoundException   if there is no such ticket, or it is not the caller's
     */
    UUID resolve(AuthPrincipal caller, String ticketId) {
        String raw = ticketId == null || ticketId.isBlank() ? null : ticketId.trim();
        if (raw == null) {
            return null;
        }
        Ticket ticket = Ids.parseUuid(raw)
                .flatMap(tickets::findById)
                .orElseThrow(() -> NotFoundException.of("Ticket"));
        if (!caller.userId().equals(ticket.getRequesterId())) {
            throw NotFoundException.of("Ticket");
        }
        return ticket.getId();
    }

    /** The 409 for a ticket that is already mirrored by a request. */
    static ConflictException alreadyMirrored() {
        return new ConflictException("That enquiry already has a service request open against it. "
                + "Continue with the existing one rather than starting a second.");
    }
}
