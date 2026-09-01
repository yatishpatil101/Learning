package com.punenest.api.services.ticket;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.RateLimitedException;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.persistence.RateLimitLock;
import com.punenest.api.common.trust.MobileMask;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import com.punenest.api.security.Teams;
import java.time.Duration;
import java.time.Instant;
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

    /**
     * Public-waitlist budget: how many tickets one number may raise in {@link #WAITLIST_WINDOW}.
     *
     * <p>Three, matching {@code SocietyLeadService}, and for the same reason — a household that
     * genuinely wants two services and mistypes once should never meet this, and a script should
     * meet it immediately. Lower would be indistinguishable from a bug to a real person; higher
     * would let one number put a page of rows in front of the desk before anything noticed.
     */
    private static final int MAX_WAITLIST_SIGNUPS = 3;

    private static final Duration WAITLIST_WINDOW = Duration.ofHours(1);

    /** What the board shows for a signup that gave no name. Not null — see {@link #joinWaitlist}. */
    private static final String ANONYMOUS_CUSTOMER = "Waitlist lead";

    private final TicketRepository tickets;
    private final TicketNoteRepository notes;
    private final TicketMapper mapper;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final AuditService audit;
    /** Makes the per-mobile budget check atomic with the insert it guards (D73). */
    private final RateLimitLock locks;

    public TicketService(TicketRepository tickets, TicketNoteRepository notes, TicketMapper mapper,
            UserRepository users, PropertyRepository properties, AuditService audit,
            RateLimitLock locks) {
        this.tickets = tickets;
        this.notes = notes;
        this.mapper = mapper;
        this.users = users;
        this.properties = properties;
        this.audit = audit;
        this.locks = locks;
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
     * number in front of ops. {@code status} and {@code value} are likewise not the caller's to set.
     *
     * <p><strong>{@code quotedValue} is the exception, and deliberately so (D3).</strong> The rule
     * above is about facts the platform owns; a price the customer picked line by line and accepted
     * is a fact about the customer, and the only party who knows it at creation time is the caller.
     * It is a distinct column from {@code value} precisely so accepting it here does not hand a
     * client the pipeline number: see {@code V83__tickets_quoted_value.sql}. Write-once — the entity
     * declares it {@code updatable = false} and {@code TicketUpdate} has no component for it — so a
     * quote cannot be revised into agreement with whatever the desk later decides to bill.
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
                requester.getMobile(), body.body(), body.quotedValue())));
    }

    /**
     * {@code POST /service-waitlist} — "tell me when this launches", from a stranger (D4).
     *
     * <p><strong>Why this is a ticket and not a table of its own.</strong> The obvious shape is a
     * {@code service_waitlist} table beside {@code city_waitlist}, and it was the wrong one: nothing
     * would read it. The city waitlist is honest about that — its repository says outright that the
     * admin surface which would consume it does not exist — but a city waitlist is a signal somebody
     * looks at once a quarter when choosing where to launch, whereas this is a person waiting for a
     * phone call. A row that no screen shows is the same outcome as the bug this replaces, where the
     * lead was written to browser storage and the customer got a success message for a lead nobody
     * received. The ops board already exists, ops already work it, and the Move-in Pack's actual
     * bookings already land there (D3), so the follow-up call happens in the same place either way.
     *
     * <p><strong>What the caller may decide, and what it may not.</strong> It supplies a service slug,
     * a mobile and optionally a name. Everything the board acts on — team, subject, priority, status
     * — is derived from the slug by {@link ServiceWaitlists} or left at its default. This is the one
     * ticket-creating path with no authenticated identity behind it, so the rule that
     * {@code create(…)} states about {@code customer} and {@code mobile} — copied from the session,
     * never read from the body — cannot apply, and the mitigation has to be that the caller controls
     * as little of the row as possible. What it does control is one bounded name field.
     *
     * <p><strong>The mobile is unverified and the row must not pretend otherwise.</strong> Nothing
     * here proves the number belongs to the person who typed it; {@code requesterId} is therefore
     * null rather than resolved by looking the number up among users. Matching an unverified number
     * to an account would attach a stranger's request to somebody's real profile, which is worse
     * than an anonymous row in every direction — and the board renders {@code customer}/{@code mobile}
     * identically either way, so the honest version costs the desk nothing.
     *
     * <p><strong>Answers 201 whether or not a row was written</strong>, like {@code /cities/waitlist}.
     * A repeat is not a conflict: the caller's intent is "make sure you have me", and after either
     * outcome the desk does. Reporting 409 on the second attempt would also turn a public form into
     * an oracle for whether a given number is already waiting.
     *
     * <p><strong>Rate-limited per mobile against the table, under a lock taken before the count</strong>
     * (D73), for the reason {@code SocietyLeadService.submit} sets out at length: an in-memory
     * counter has nothing to hang a bucket off when there is no session, and counting rows is only a
     * limit if nobody can insert between the count and the insert. The duplicate check sits inside
     * the same lock and the same transaction, so two simultaneous taps on the same button produce
     * one ticket rather than two.
     *
     * <p>Returns nothing. An anonymous caller cannot read {@code GET /tickets}, so handing it a
     * ticket id would be a reference it can never resolve — and one it could quote at support as
     * evidence of a request the desk may never have seen.
     *
     * <p>Mutation checks, run and confirmed: disabling the duplicate guard fails
     * {@code askingTwiceLeavesOneRowOnTheBoard} ("expected size: 1 but was: 2"), and disabling the
     * budget fails {@code theBudgetCountsEveryTicketThatNumberHasRaised} ("status expected 429 but
     * was 201"). Both were reverted and the suite re-run green.
     */
    @Transactional
    public void joinWaitlist(ServiceWaitlistRequest body) {
        String slug = blankToNull(body.service());
        if (!ServiceWaitlists.isKnown(slug)) {
            throw new BadRequestException("Unknown service: " + body.service());
        }
        String subject = ServiceWaitlists.subjectFor(slug);
        // @IndianMobile checked the shape; canonicalise once so the lock key, the budget query and
        // the stored row all key off the same ten digits.
        String mobile = MobileMask.normalise(body.mobile());

        locks.holdUntilCommit(RateLimitLock.Limit.SERVICE_WAITLIST, mobile);
        if (tickets.existsByMobileAndSubjectAndStatusIn(
                mobile, subject, TicketStatuses.UNRESOLVED)) {
            // Already waiting, and nobody has dealt with them yet. Silently successful: see above.
            return;
        }
        if (tickets.countByMobileAndCreatedAtAfter(mobile, Instant.now().minus(WAITLIST_WINDOW))
                >= MAX_WAITLIST_SIGNUPS) {
            throw new RateLimitedException(
                    "Too many requests from this number — we already have your details.",
                    (int) WAITLIST_WINDOW.toSeconds());
        }

        String name = blankToNull(body.name());
        tickets.save(new Ticket(subject, ServiceWaitlists.teamFor(slug), null, null, null,
                name == null ? ANONYMOUS_CUSTOMER : name.strip(), mobile, null, null));
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
