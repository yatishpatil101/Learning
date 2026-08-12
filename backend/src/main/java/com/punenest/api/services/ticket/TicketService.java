package com.punenest.api.services.ticket;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import com.punenest.api.security.Teams;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The ops ticket board: raise, work, annotate.
 *
 * <p><strong>Team scoping, and why it fails closed.</strong> A staff member sees and works only
 * their own desk's tickets; an admin sees everything. A staff member with no {@code team} on their
 * account sees <em>nothing</em> — not everything. That case is a misconfigured account, and the safe
 * reading of "which desk is this person on?" with no answer is "none", not "all of them".
 *
 * <p><strong>Cross-desk access is a 403, not a 404</strong> — the opposite of the customer-facing
 * rule used throughout the platform. Existence is the secret when the reader might be a stranger;
 * here every reader has already passed a staff/admin guard, so hiding the legal desk's queue from
 * the rental desk protects nothing and would send a staffer hunting for a ticket they can plainly
 * see referenced in an email. Being told "that belongs to the legal desk" is the useful answer.
 *
 * <p><strong>Service requests are scoped the same way</strong> (D44, closed). They used to be the
 * exception: {@code service_requests} had no team column and its {@code type} was free text, so a
 * desk could only have been inferred from the type string — and the day somebody added a new service
 * type, every request of it would have belonged to nobody and vanished from every queue. V42 closed
 * the type vocabulary and V72 gave the table a {@code team} of its own, paired to the type by a
 * CHECK that is total over that vocabulary, so an unmapped type is refused at INSERT instead of
 * being silently hidden. {@code ServiceRequestService.list} then applies the identical three rules
 * above. A request also names the ticket it came off ({@code service_requests.ticket_id}, D45), so
 * an operator working one can reach the other.
 */
@Service
public class TicketService {

    private final TicketRepository tickets;
    private final TicketNoteRepository notes;
    private final TicketMapper mapper;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final AuditService audit;

    public TicketService(TicketRepository tickets, TicketNoteRepository notes, TicketMapper mapper,
            UserRepository users, PropertyRepository properties, AuditService audit) {
        this.tickets = tickets;
        this.notes = notes;
        this.mapper = mapper;
        this.users = users;
        this.properties = properties;
        this.audit = audit;
    }

    /**
     * Contract {@code listTickets} — staff/admin, team-scoped.
     *
     * @param team ignored for a staff caller unless it names their own desk, in which case it is
     *             redundant; naming somebody else's is a 403 rather than a silent substitution,
     *             because a filter that quietly does something other than what it says is worse than
     *             one that refuses
     */
    @Transactional(readOnly = true)
    public Page<TicketDto> list(AuthPrincipal caller, String team, String status, Pageable pageable) {
        String requested = blankToNull(team);
        if (requested != null && !Teams.isKnown(requested)) {
            throw new BadRequestException("Unknown team: " + requested);
        }
        String statusFilter = blankToNull(status);
        if (statusFilter != null && !TicketStatuses.isKnown(statusFilter)) {
            throw new BadRequestException("Unknown ticket status: " + statusFilter);
        }

        String scope;
        if (isAdmin(caller)) {
            scope = requested;
        } else {
            if (caller.team() == null) {
                throw new ForbiddenException(
                        "Your account is not on an ops desk yet, so there is no queue to show.");
            }
            if (requested != null && !requested.equals(caller.team())) {
                throw new ForbiddenException("You can only see the " + caller.team() + " queue.");
            }
            scope = caller.team();
        }

        Page<Ticket> page = tickets.findForBoard(scope, statusFilter, pageable);
        return new PageImpl<>(mapper.toDtos(page.getContent()), page.getPageable(),
                page.getTotalElements());
    }

    /**
     * Contract {@code createTicket} — 201. <strong>Any authenticated caller</strong>, per the
     * contract's deliberate absence of {@code x-roles} (spec fix S43): a customer raising a request
     * is the point of the queue, exactly as with {@code POST /reports}.
     *
     * <p>{@code customer} and {@code mobile} are copied off the authenticated user, never read from
     * the body — a ticket that named somebody else would be a free way to put an arbitrary phone
     * number in front of ops.
     *
     * <p>Returns {@link CustomerTicketDto}, not {@link TicketDto}: this is the one response on the
     * board that reaches a non-staff caller, and the staff record carries internal notes (debt D47).
     */
    @Transactional
    public CustomerTicketDto create(AuthPrincipal caller, TicketCreate body) {
        String team = blankToNull(body.team());
        if (team != null && !Teams.isKnown(team)) {
            throw new BadRequestException("Unknown team: " + team);
        }
        String priority = blankToNull(body.priority());
        if (priority != null && !TicketPriorities.isKnown(priority)) {
            throw new BadRequestException("Unknown priority: " + priority);
        }
        UUID propertyId = body.propertyId() == null || body.propertyId().isBlank()
                ? null
                : Ids.parseUuid(body.propertyId())
                        .orElseThrow(() -> new BadRequestException("propertyId must be a valid id"));
        // tickets.property_id is a foreign key (V7); an unchecked id is a 500 from the constraint
        // rather than an answer to the caller.
        if (propertyId != null && !properties.existsById(propertyId)) {
            throw NotFoundException.of("Property");
        }

        User requester = users.findById(caller.userId())
                .orElseThrow(() -> NotFoundException.of("User"));
        return mapper.toCustomer(tickets.saveAndFlush(new Ticket(body.subject().trim(), team,
                priority, propertyId, requester.getId(), requester.getName(),
                requester.getMobile(), body.body())));
    }

    /**
     * Contract {@code updateTicket} (spec fix S42) — staff/admin, own desk.
     *
     * <p>Re-teaming is allowed and routinely loses the caller their own visibility of the ticket.
     * That is correct: misfiled work should go to the right desk, and the desk that no longer owns
     * it should no longer see it.
     *
     * <p>An omitted {@code assigneeId} leaves the current assignee alone; the reserved value
     * {@link TicketUpdate#UNASSIGN} hands the ticket back to the pool (debt D46). Those are the only
     * two ways to not-assign somebody — anything else that fails to resolve to an ops user is still
     * a 404, so a mistyped id cannot quietly become an unassignment.
     *
     * @throws NotFoundException  if the assignee id does not resolve to an ops user — assigning work
     *                            to a customer is not a typo worth honouring
     * @throws ForbiddenException if the ticket belongs to another desk
     */
    @Transactional
    public TicketDto update(AuthPrincipal caller, String id, TicketUpdate body) {
        Ticket ticket = accessible(caller, id);
        String fromStatus = ticket.getStatus();
        String fromTeam = ticket.getTeam();

        String status = blankToNull(body.status());
        if (status != null) {
            if (!TicketStatuses.isKnown(status)) {
                throw new BadRequestException("Unknown ticket status: " + status);
            }
            ticket.setStatus(status);
        }
        String priority = blankToNull(body.priority());
        if (priority != null) {
            if (!TicketPriorities.isKnown(priority)) {
                throw new BadRequestException("Unknown priority: " + priority);
            }
            ticket.setPriority(priority);
        }
        String team = blankToNull(body.team());
        if (team != null) {
            if (!Teams.isKnown(team)) {
                throw new BadRequestException("Unknown team: " + team);
            }
            ticket.setTeam(team);
        }
        String assigneeId = blankToNull(body.assigneeId());
        if (body.unassigns()) {
            // Debt D46. The one intent a record cannot express as a null, so it has a word instead;
            // see TicketUpdate.UNASSIGN for why that is a word and not a wrapper or an endpoint.
            ticket.setAssigneeId(null);
        } else if (assigneeId != null) {
            User assignee = Ids.parseUuid(assigneeId)
                    .flatMap(users::findById)
                    .filter(u -> Roles.Wire.STAFF.equals(u.getRole())
                            || Roles.Wire.ADMIN.equals(u.getRole()))
                    .orElseThrow(() -> new NotFoundException("No such staff member to assign"));
            ticket.setAssigneeId(assignee.getId());
        }

        audit.record(caller, "ticket.update", "ticket", ticket.getId().toString(),
                "fromStatus", fromStatus, "toStatus", ticket.getStatus(),
                "fromTeam", fromTeam, "toTeam", ticket.getTeam(),
                "assigneeId", body.assigneeId());
        return mapper.toDto(ticket);
    }

    /**
     * Contract {@code addTicketNote} — 201. Staff/admin, own desk.
     *
     * <p>The note is attributed to the caller's name, taken from their account. The contract's
     * {@code by} field is a display name, so there is no id to spoof — but the value still comes
     * from the principal rather than the body, because "who wrote this" is not a client's opinion.
     */
    @Transactional
    public TicketDto.Note addNote(AuthPrincipal caller, String id, String text) {
        Ticket ticket = accessible(caller, id);
        String author = users.findById(caller.userId()).map(User::getName).orElse(null);
        TicketNote saved = notes.saveAndFlush(new TicketNote(ticket.getId(), author, text));
        return new TicketDto.Note(saved.getBy(), saved.getText(), saved.getAt());
    }

    private Ticket accessible(AuthPrincipal caller, String id) {
        Ticket ticket = Ids.parseUuid(id)
                .flatMap(tickets::findById)
                .orElseThrow(() -> NotFoundException.of("Ticket"));
        if (isAdmin(caller)) {
            return ticket;
        }
        if (caller.team() == null) {
            throw new ForbiddenException("Your account is not on an ops desk yet.");
        }
        if (!caller.team().equals(ticket.getTeam())) {
            throw new ForbiddenException("That ticket belongs to the "
                    + (ticket.getTeam() == null ? "unassigned" : ticket.getTeam()) + " desk.");
        }
        return ticket;
    }

    private static boolean isAdmin(AuthPrincipal caller) {
        return Roles.Wire.ADMIN.equals(caller.role());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
