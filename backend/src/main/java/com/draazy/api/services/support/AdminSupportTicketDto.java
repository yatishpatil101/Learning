package com.draazy.api.services.support;

import java.time.Instant;

/**
 * Contract {@code AdminSupportTicket} — one row of the platform-wide support queue (D51).
 *
 * <p><strong>A summary, not the ticket.</strong> {@link SupportTicketDto} carries the whole thread
 * inline because a customer's own support history is small; this list grows with the platform, so
 * embedding threads would make a page of twenty tickets an unbounded response by another route. The
 * desk pages this list to find a ticket and then opens it at {@code GET /support/tickets/{id}},
 * which staff have always been able to read. Same split as {@code leads.conversation.ConversationDto}
 * makes between the inbox and the thread.
 *
 * <p><strong>Why the raiser's name and nothing else about them.</strong> A queue of subjects with no
 * indication of who is waiting is not triageable, so the name is here. The mobile is not: the ticket
 * detail already reveals it to the same callers, and the paged directory at {@code GET /users} masks
 * it for exactly this reason — a list is the shape that gets exported, and this one is the whole
 * platform's support traffic.
 *
 * @param awaitingReply the desk's side of the read model — a customer message no staff member has
 *     read. This is what makes the list a queue rather than an archive.
 * @param unread the raiser's side — a staff reply the customer has not opened yet. Useful in the
 *     other direction: it distinguishes "we have not answered" from "we answered and they have not
 *     looked", which are different follow-ups.
 */
public record AdminSupportTicketDto(
        String id,
        String subject,
        String category,
        String status,
        String raiser,
        boolean awaitingReply,
        boolean unread,
        Instant createdAt) {
}
