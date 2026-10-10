package com.draazy.api.services.ticket;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import com.draazy.api.security.Teams;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Team scoping: staff see only their desk's tickets plus team-less ones no desk owns yet; admins see all.
@Service
public class TicketService {

    // Three matches SocietyLeadService: real households rarely hit it; scripts do fast.
    private static final int MAX_WAITLIST_SIGNUPS = 3;

    private static final Duration WAITLIST_WINDOW = Duration.ofHours(1);

    private static final String ANONYMOUS_CUSTOMER = "Waitlist lead";

    private final TicketRepository tickets;
    private final TicketNoteRepository notes;
    private final TicketMapper mapper;
    private final UserRepository users;
    private final PropertyRepository properties;
    private final AuditService audit;

    private final RateLimitLock locks;
    private final AccountPermissions accountPermissions;

    public TicketService(TicketRepository tickets, TicketNoteRepository notes, TicketMapper mapper,
            UserRepository users, PropertyRepository properties, AuditService audit,
            RateLimitLock locks, AccountPermissions accountPermissions) {
        this.tickets = tickets;
        this.notes = notes;
        this.mapper = mapper;
        this.users = users;
        this.properties = properties;
        this.audit = audit;
        this.locks = locks;
        this.accountPermissions = accountPermissions;
    }

    @Transactional(readOnly = true)
    public Page<TicketDto> list(AuthPrincipal caller, String team, String status, Pageable pageable) {
        String statusFilter = blankToNull(status);
        if (statusFilter != null && !TicketStatuses.isKnown(statusFilter)) {
            throw new BadRequestException("Unknown ticket status: " + statusFilter);
        }
        BoardScope scope = boardScope(caller, team);
        Page<Ticket> page = tickets.findForBoard(scope.allTeams(), scope.teams(), scope.unassigned(), statusFilter, pageable);
        return new PageImpl<>(mapper.toDtos(page.getContent()), page.getPageable(),
                page.getTotalElements());
    }

    // The board's rows: the same scope as `list`, narrowed by priority and a contains-search, with no notes read.
    @Transactional(readOnly = true)
    public Page<TicketRow> rows(AuthPrincipal caller, String team, String status, String priority, String q,
            Pageable pageable) {
        String statusFilter = blankToNull(status);
        if (statusFilter != null && !TicketStatuses.isKnown(statusFilter)) {
            throw new BadRequestException("Unknown ticket status: " + statusFilter);
        }
        String priorityFilter = blankToNull(priority);
        if (priorityFilter != null && !TicketPriorities.isKnown(priorityFilter)) {
            throw new BadRequestException("Unknown priority: " + priorityFilter);
        }
        String term = blankToNull(q);
        BoardScope scope = boardScope(caller, team);
        Page<Ticket> page = tickets.findRowsForBoard(scope.allTeams(), scope.teams(), scope.unassigned(), statusFilter, priorityFilter,
                term == null ? null : containsPattern(term), pageable);
        return new PageImpl<>(mapper.toRows(page.getContent()), page.getPageable(), page.getTotalElements());
    }

    @Transactional(readOnly = true)
    public TicketSummary summary(AuthPrincipal caller, String team) {
        BoardScope scope = boardScope(caller, team);
        Map<String, Long> byStatus = new HashMap<>();
        for (TicketRepository.StatusTotal total : tickets.countByStatusForBoard(scope.allTeams(), scope.teams(), scope.unassigned())) {
            byStatus.put(total.getStatus(), total.getTotal());
        }
        long all = byStatus.values().stream().mapToLong(Long::longValue).sum();
        return new TicketSummary(byStatus.getOrDefault(TicketStatuses.OPEN, 0L),
                byStatus.getOrDefault(TicketStatuses.IN_PROGRESS, 0L),
                byStatus.getOrDefault(TicketStatuses.WAITING, 0L),
                byStatus.getOrDefault(TicketStatuses.RESOLVED, 0L),
                byStatus.getOrDefault(TicketStatuses.CLOSED, 0L), all);
    }

    @Transactional(readOnly = true)
    public TicketDto get(AuthPrincipal caller, String id) {
        return mapper.toDto(accessible(caller, id));
    }

    // An unescaped % or _ would slip the caller's own wildcard into the search.
    private static String containsPattern(String term) {
        return "%" + term.toLowerCase(Locale.ROOT).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    /** What {@code list(team, "open")} would total, without reading a page. */
    @Transactional(readOnly = true)
    public long countOpen(AuthPrincipal caller, String team) {
        BoardScope scope = boardScope(caller, team);
        return tickets.countForBoard(scope.allTeams(), scope.teams(), scope.unassigned(), TicketStatuses.OPEN);
    }

    private record BoardScope(boolean allTeams, List<String> teams, boolean unassigned) {
    }

    private BoardScope boardScope(AuthPrincipal caller, String team) {
        String requested = blankToNull(team);
        if (requested != null && !Teams.isKnown(requested)) {
            throw new BadRequestException("Unknown team: " + requested);
        }
        if (isAdmin(caller)) {
            return new BoardScope(requested == null, requested == null ? List.of("__all__") : List.of(requested), false);
        }
        Set<String> desks = accountPermissions.desksFor(caller);
        if (desks.isEmpty()) {
            throw new ForbiddenException(
                    "Your account is not on an ops desk yet, so there is no queue to show.");
        }
        if (requested != null && !desks.contains(requested)) {
            throw new ForbiddenException("You can only see your assigned queues.");
        }
        return new BoardScope(false, requested == null ? new ArrayList<>(desks) : List.of(requested), requested == null);
    }

    // quotedValue is caller-owned at creation; ops fills platform facts later.
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
                : Ids.parseUuid(body.propertyId()).orElseThrow(() -> new BadRequestException("propertyId must be a valid id"));

        // Check FK upfront so bad property ids return caller-facing 404, not constraint 500.
        if (propertyId != null && !properties.existsById(propertyId)) {
            throw NotFoundException.of("Property");
        }

        User requester = users.findById(caller.userId()).orElseThrow(() -> NotFoundException.of("User"));
        return mapper.toCustomer(tickets.saveAndFlush(new Ticket(body.subject().trim(), team,
                priority, propertyId, requester.getId(), requester.getName(),
                requester.getMobile(), body.body(), body.quotedValue())));
    }

    // Waitlist mobiles are unverified; do not resolve requesterId from typed numbers.
    @Transactional
    public void joinWaitlist(ServiceWaitlistRequest body) {
        String slug = blankToNull(body.service());
        if (!ServiceWaitlists.isKnown(slug)) {
            throw new BadRequestException("Unknown service: " + body.service());
        }
        String subject = ServiceWaitlists.subjectFor(slug);

        // Canonicalise once so lock, budget query, and row share the same ten digits.
        String mobile = MobileMask.normalise(body.mobile());

        locks.holdUntilCommit(RateLimitLock.Limit.SERVICE_WAITLIST, mobile);
        if (tickets.existsByMobileAndSubjectAndStatusIn(
                mobile, subject, TicketStatuses.UNRESOLVED)) {

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

    // Omitted assignee leaves current value; UNASSIGN returns ticket to pool.
    // Any other bad id stays 404, not quiet unassignment.
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
            if (!isAdmin(caller) && !accountPermissions.desksFor(caller).contains(team)) {
                throw new ForbiddenException("You can only move tickets to your assigned queues.");
            }
            ticket.setTeam(team);
        }
        String assigneeId = blankToNull(body.assigneeId());
        if (body.unassigns()) {

            // Null needs an explicit intent word; see TicketUpdate.UNASSIGN.
            ticket.setAssigneeId(null);
        } else if (assigneeId != null) {
            User assignee = Ids.parseUuid(assigneeId).flatMap(users::findById)
                    .filter(u -> Roles.isBackOffice(u.getRole()))
                    .orElseThrow(() -> new NotFoundException("No such staff member to assign"));
            ticket.setAssigneeId(assignee.getId());
        }

        audit.record(caller, "ticket.update", "ticket", ticket.getId().toString(),
                "fromStatus", fromStatus, "toStatus", ticket.getStatus(),
                "fromTeam", fromTeam, "toTeam", ticket.getTeam(),
                "assigneeId", body.assigneeId());
        return mapper.toDto(ticket);
    }

    // Note author comes from principal; display name is not client input.
    @Transactional
    public TicketDto.Note addNote(AuthPrincipal caller, String id, String text) {
        Ticket ticket = accessible(caller, id);
        String author = users.findById(caller.userId()).map(User::getName).orElse(null);
        TicketNote saved = notes.saveAndFlush(new TicketNote(ticket.getId(), author, text));
        return new TicketDto.Note(saved.getBy(), saved.getText(), saved.getAt());
    }

    private Ticket accessible(AuthPrincipal caller, String id) {
        Ticket ticket = Ids.parseUuid(id).flatMap(tickets::findById).orElseThrow(() -> NotFoundException.of("Ticket"));
        if (isAdmin(caller)) {
            return ticket;
        }
        Set<String> desks = accountPermissions.desksFor(caller);
        if (desks.isEmpty()) {
            throw new ForbiddenException("Your account is not on an ops desk yet.");
        }
        if (ticket.getTeam() != null && !desks.contains(ticket.getTeam())) {
            throw new ForbiddenException("That ticket belongs to the " + ticket.getTeam() + " desk.");
        }
        return ticket;
    }

    private static boolean isAdmin(AuthPrincipal caller) {
        return Roles.Wire.ADMIN.equals(caller.role()) || Roles.Wire.MANAGER.equals(caller.role());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
