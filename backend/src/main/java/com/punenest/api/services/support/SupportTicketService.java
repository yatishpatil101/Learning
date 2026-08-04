package com.punenest.api.services.support;

import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The customer's support conversation with the platform.
 *
 * <p><strong>Two audiences, one resource.</strong> The raiser owns the ticket; staff and admin may
 * read and answer any of them, because that is the job. The list, however, is the caller's own for
 * everyone (spec fix S47) — "every support conversation on the platform" is an unbounded export of
 * names, mobiles and message bodies, and it is not what a bare array can safely be. Ops triage
 * already has its own paginated, team-scoped board at {@code GET /tickets}.
 *
 * <p>An admin therefore has no platform-wide support list here, deliberately. When one is needed it
 * belongs under {@code /admin/} with a page envelope, not as a role branch inside this method.
 *
 * <p><strong>{@code unread} points one way.</strong> It means "a support reply the raiser has not
 * read". Staff replying sets it; the raiser replying does not; {@code POST /{id}/read} clears it. Ops
 * gets no unread signal from this column — see the debt register.
 */
@Service
public class SupportTicketService {

    private final SupportTicketRepository tickets;
    private final SupportTicketMessageRepository messages;
    private final SupportTicketMapper mapper;
    private final UserRepository users;

    public SupportTicketService(SupportTicketRepository tickets,
            SupportTicketMessageRepository messages, SupportTicketMapper mapper,
            UserRepository users) {
        this.tickets = tickets;
        this.messages = messages;
        this.mapper = mapper;
        this.users = users;
    }

    /** {@code GET /support/tickets} — the caller's own, newest first. */
    @Transactional(readOnly = true)
    public List<SupportTicketDto> list(AuthPrincipal caller) {
        return mapper.toDtos(tickets.findByUserIdOrderByCreatedAtDesc(caller.userId()));
    }

    /** {@code POST /support/tickets} — 201, with the opening message already on the thread. */
    @Transactional
    public SupportTicketDto create(AuthPrincipal caller, SupportTicketCreate body) {
        SupportTicket ticket = tickets.saveAndFlush(
                new SupportTicket(caller.userId(), body.subject(), body.category()));
        write(ticket, caller, body.body());
        return mapper.toDto(ticket);
    }

    /** {@code GET /support/tickets/{id}} — the raiser or ops. Anyone else gets a 404. */
    @Transactional(readOnly = true)
    public SupportTicketDto get(AuthPrincipal caller, String id) {
        return mapper.toDto(readable(caller, id));
    }

    /**
     * {@code POST /support/tickets/{id}/messages} — 201 with the message as sent.
     *
     * <p>A staff or admin reply raises {@code unread}; the raiser's own reply does not, because the
     * flag is theirs and answering your own ticket does not give you something new to read.
     */
    @Transactional
    public MessageDto reply(AuthPrincipal caller, String id, String body) {
        SupportTicket ticket = readable(caller, id);
        SupportTicketMessage sent = write(ticket, caller, body);
        if (!ticket.getUserId().equals(caller.userId())) {
            ticket.setUnread(true);
            tickets.saveAndFlush(ticket);
        }
        User author = users.findById(caller.userId()).orElse(null);
        return new MessageDto(
                sent.getId().toString(),
                author == null ? null : author.getName(),
                sent.getAuthorRole(),
                sent.getBody(),
                sent.getCreatedAt());
    }

    /**
     * {@code POST /support/tickets/{id}/read} — 204, idempotent.
     *
     * <p>Clears the flag only for the raiser. A staff caller reaches this successfully and changes
     * nothing, which is the accurate outcome rather than a swallowed failure: the column tracks the
     * customer's reading, ops has no unread signal on this surface, and clearing the customer's flag
     * on ops' behalf would tell the customer they had read a reply they have not seen.
     */
    @Transactional
    public void markRead(AuthPrincipal caller, String id) {
        SupportTicket ticket = readable(caller, id);
        if (ticket.getUserId().equals(caller.userId()) && ticket.isUnread()) {
            ticket.setUnread(false);
            tickets.saveAndFlush(ticket);
        }
    }

    private SupportTicketMessage write(SupportTicket ticket, AuthPrincipal author, String body) {
        return messages.saveAndFlush(new SupportTicketMessage(
                ticket.getId(), author.userId(), author.role(), body));
    }

    /**
     * The raiser or ops, else 404 — not 403. The id is the secret here as it is on conversations:
     * a 403 would confirm that a ticket with that id exists.
     */
    private SupportTicket readable(AuthPrincipal caller, String id) {
        return Ids.parseUuid(id)
                .flatMap(tickets::findById)
                .filter(t -> t.getUserId().equals(caller.userId()) || isOps(caller))
                .orElseThrow(() -> NotFoundException.of("Support ticket"));
    }

    private static boolean isOps(AuthPrincipal caller) {
        return Roles.Wire.STAFF.equals(caller.role()) || Roles.Wire.ADMIN.equals(caller.role());
    }
}
