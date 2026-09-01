package com.draazy.api.services.support;

import com.draazy.api.common.attachment.MessageAttachmentDto;
import com.draazy.api.common.attachment.MessageAttachments;
import com.draazy.api.common.attachment.MessageSurfaces;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

/**
 * The customer's support conversation with the platform.
 *
 * <p><strong>Two audiences, one resource.</strong> The raiser owns the ticket; staff and admin may
 * read and answer any of them, because that is the job. The list at {@code GET /support/tickets},
 * however, is the caller's own for everyone (spec fix S47) — "every support conversation on the
 * platform" is an unbounded export of names, mobiles and message bodies, and it is not what a bare
 * array can safely be.
 *
 * <p>The platform-wide view ops needs now exists, and it is a different operation rather than a role
 * branch inside that one: {@link #queue} serves {@code GET /admin/support-tickets}, paged, staff and
 * admin only, threads omitted (D51). Ops triage for work items still has its own team-scoped board
 * at {@code GET /tickets}; this is the customer-conversation side of the desk.
 *
 * <p><strong>{@code unread} points both ways now, through two columns (D50, V53).</strong> Each side
 * is marked by the other side writing and cleared by its own side reading:
 *
 * <ul>
 *   <li>a staff or admin reply raises the raiser's {@code unread}; the raiser's own reply does not,
 *       because answering your own ticket gives you nothing new to read;</li>
 *   <li>the raiser writing — the opening message included — raises the desk's {@code staffUnread};
 *       a staff reply does not;</li>
 *   <li>{@code POST /{id}/read} clears whichever flag belongs to the caller, and only that one.</li>
 * </ul>
 */
@Service
public class SupportTicketService {

    private final SupportTicketRepository tickets;
    private final SupportTicketMessageRepository messages;
    private final SupportTicketMapper mapper;
    private final UserRepository users;
    private final MessageAttachments attachments;

    public SupportTicketService(SupportTicketRepository tickets,
            SupportTicketMessageRepository messages, SupportTicketMapper mapper,
            UserRepository users, MessageAttachments attachments) {
        this.tickets = tickets;
        this.messages = messages;
        this.mapper = mapper;
        this.users = users;
        this.attachments = attachments;
    }

    /** {@code GET /support/tickets} — the caller's own, newest first. */
    @Transactional(readOnly = true)
    public List<SupportTicketDto> list(AuthPrincipal caller) {
        return mapper.toDtos(tickets.findByUserIdOrderByCreatedAtDesc(caller.userId()));
    }

    /**
     * {@code GET /admin/support-tickets} — the platform-wide queue, paged (D51).
     *
     * <p>Authorisation is the controller's: this is a plain role question, unlike every other read
     * here, which is "is this your ticket, or are you ops" and has to see the row to answer.
     *
     * @param awaitingReply {@code true} to narrow to tickets with a customer message nobody on the
     *     desk has read — the working view. {@code null} for everything, which is the archive.
     *     {@code false} is accepted and means "tickets nobody is waiting on", which nothing asks for
     *     but is the honest reading of the parameter rather than a silently ignored value.
     */
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

    /**
     * {@code POST /support/tickets} — 201, with the opening message already on the thread.
     *
     * <p>Raised for the desk from the moment it exists: the opening message is a customer message
     * nobody has read, and a queue that only counts <em>replies</em> would show an empty board on a
     * day full of new tickets.
     */
    @Transactional
    public SupportTicketDto create(AuthPrincipal caller, SupportTicketCreate body) {
        SupportTicket raised = new SupportTicket(caller.userId(), body.subject(), body.category());
        raised.setStaffUnread(true);
        SupportTicket ticket = tickets.saveAndFlush(raised);
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
     * <p>A reply marks the <em>other</em> side unread and never the writer's own: staff answering
     * raises the raiser's flag, the raiser answering raises the desk's. Answering your own ticket
     * gives you nothing new to read, in either direction.
     *
     * <p>{@code attachmentIds} are bound after {@link #readable} has answered and inside the same
     * transaction as the message (D49), so a caller with no claim on the ticket never reaches an
     * attachment row and a reply that names one it may not have leaves neither behind.
     */
    @Transactional
    public MessageDto reply(AuthPrincipal caller, String id, String body, List<String> attachmentIds) {
        SupportTicket ticket = readable(caller, id);
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
                sent.getAuthorId().toString(),
                author == null ? null : author.getName(),
                sent.getAuthorRole(),
                sent.getBody(),
                sent.getCreatedAt(),
                attachments.bind(ticket.getId(), caller.userId(), sent.getId(), attachmentIds));
    }

    /**
     * {@code POST /support/tickets/{id}/attachments} — 201 with the stored attachment.
     *
     * <p>Guarded by {@link #readable} and nothing else: an upload on a ticket is exactly as private
     * as the ticket, so the raiser-or-ops rule decides here too.
     */
    @Transactional
    public MessageAttachmentDto attach(AuthPrincipal caller, String id, MultipartFile file) {
        SupportTicket ticket = readable(caller, id);
        return attachments.upload(MessageSurfaces.SUPPORT_TICKET, ticket.getId(),
                caller.userId(), file);
    }

    /**
     * {@code POST /support/tickets/{id}/read} — 204, idempotent.
     *
     * <p>Clears the caller's own side and only that one. A staff read no longer does nothing (which
     * was the accurate outcome while the desk had no flag of its own) — it clears
     * {@code staffUnread}, taking the ticket out of the ops queue. What it still must not do is
     * clear the customer's flag, which would tell them they had read a reply they have not seen.
     */
    @Transactional
    public void markRead(AuthPrincipal caller, String id) {
        SupportTicket ticket = readable(caller, id);
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
