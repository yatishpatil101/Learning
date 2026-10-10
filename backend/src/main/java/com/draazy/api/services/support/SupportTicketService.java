package com.draazy.api.services.support;

import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

// Two audiences, one resource.
// The raiser owns the ticket; staff and admin may read and answer any of them, because that is the job.
@Service
public class SupportTicketService {

    private final SupportTicketRepository tickets;
    private final SupportTicketMessageRepository messages;
    private final SupportTicketMapper mapper;
    private final UserRepository users;
    private final AccountPermissions permissions;

    public SupportTicketService(SupportTicketRepository tickets,
            SupportTicketMessageRepository messages, SupportTicketMapper mapper,
            UserRepository users, AccountPermissions permissions) {
        this.tickets = tickets;
        this.messages = messages;
        this.mapper = mapper;
        this.users = users;
        this.permissions = permissions;
    }

    @Transactional(readOnly = true)
    public List<SupportTicketSummary> list(AuthPrincipal caller) {
        return mapper.toSummaries(tickets.findByUserIdOrderByCreatedAtDesc(caller.userId()));
    }

    @Transactional(readOnly = true)
    public Page<AdminSupportTicketDto> queue(Boolean awaitingReply, Pageable pageable) {
        Pageable page = Pageables.unsorted(pageable);
        if (awaitingReply == null) {
            return mapper.toAdminPage(tickets.findAllByOrderByCreatedAtDesc(page));
        }
        return awaitingReply
                ? mapper.toAdminPage(tickets.findByStaffUnreadTrueOrderByCreatedAtDesc(page))
                : mapper.toAdminPage(tickets.findByStaffUnreadFalseOrderByCreatedAtDesc(page));
    }

    @Transactional(readOnly = true)
    public Map<String, Long> queueCounts() {
        long awaiting = 0;
        long answered = 0;
        for (Object[] row : tickets.countByStaffUnread()) {
            if ((Boolean) row[0]) {
                awaiting += (Long) row[1];
            } else {
                answered += (Long) row[1];
            }
        }
        return Map.of("awaiting", awaiting, "answered", answered, "all", awaiting + answered);
    }

    // Opening messages are unread for the desk; otherwise new tickets vanish from the queue.
    @Transactional
    public SupportTicketDto create(AuthPrincipal caller, SupportTicketCreate body) {
        SupportTicket raised = new SupportTicket(caller.userId(), body.subject(), body.category());
        raised.setStaffUnread(true);
        SupportTicket ticket = tickets.saveAndFlush(raised);
        write(ticket, caller, body.body());
        return mapper.toDto(ticket);
    }

    // A desk member opening a ticket clears the desk's side; the raiser's own flag is cleared by markRead.
    @Transactional
    public SupportTicketDto get(AuthPrincipal caller, String id) {
        SupportTicket ticket = readable(caller, id, BackOfficePermissions.TICKETS_READ);
        if (ticket.isStaffUnread() && !ticket.getUserId().equals(caller.userId())
                && permissions.granted(caller, BackOfficePermissions.TICKETS_WRITE)) {
            ticket.setStaffUnread(false);
            tickets.saveAndFlush(ticket);
        }
        return mapper.toDto(ticket);
    }

    @Transactional
    public MessageDto reply(AuthPrincipal caller, String id, String body) {
        SupportTicket ticket = readable(caller, id, BackOfficePermissions.TICKETS_WRITE);
        SupportTicketMessage sent = write(ticket, caller, body);
        if (ticket.getUserId().equals(caller.userId())) {
            ticket.setStaffUnread(true);
        } else {
            ticket.setUnread(true);
        }
        tickets.saveAndFlush(ticket);
        User author = users.findById(caller.userId()).orElse(null);
        return new MessageDto(
                sent.getId().toString(),
                author == null ? null : author.getName(),
                sent.getAuthorRole(),
                sent.getBody(),
                sent.getCreatedAt());
    }

    // Clears only the caller's side; staff reads remove tickets from the ops queue.
    @Transactional
    public void markRead(AuthPrincipal caller, String id) {
        SupportTicket ticket = readable(caller, id, BackOfficePermissions.TICKETS_WRITE);
        boolean raiser = ticket.getUserId().equals(caller.userId());
        if (raiser && ticket.isUnread()) {
            ticket.setUnread(false);
            tickets.saveAndFlush(ticket);
        } else if (!raiser && ticket.isStaffUnread()) {
            ticket.setStaffUnread(false);
            tickets.saveAndFlush(ticket);
        }
    }

    private SupportTicketMessage write(SupportTicket ticket, AuthPrincipal author, String body) {
        return messages.saveAndFlush(new SupportTicketMessage(
                ticket.getId(), author.userId(), author.role(), body));
    }

    private SupportTicket readable(AuthPrincipal caller, String id, String permission) {
        SupportTicket ticket = Ids.parseUuid(id).flatMap(tickets::findById)
                .orElseThrow(() -> NotFoundException.of("Support ticket"));
        if (ticket.getUserId().equals(caller.userId())) {
            return ticket;
        }
        if (!Roles.isBackOffice(caller.role())) {
            throw NotFoundException.of("Support ticket");
        }
        if (!permissions.granted(caller, permission)) {
            throw new ForbiddenException("Your account cannot access support tickets.");
        }
        return ticket;
    }
}
