package com.punenest.api.services.support;

import com.punenest.api.common.persistence.VersionedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * A customer's support conversation with the platform. Maps {@code support_tickets} (V8).
 *
 * <p><strong>Not the same thing as {@code services.ticket.Ticket}</strong>, despite the name. That
 * one is the internal ops board — team, priority, assignee, private notes — and its rows are created
 * by staff about work. This one is raised by a customer, has no assignee and no notes, and its whole
 * state is a subject, a status and a thread. Merging them would mean either exposing the ops fields
 * to the customer or nulling half a row on every insert; keeping them apart is why {@code TicketDto}
 * never has to decide whether its notes are safe to show.
 *
 * <p>{@code unread} means "a support reply the ticket's owner has not read". One boolean cannot mean
 * two things, so it is the customer's signal only: staff answering sets it, the customer's own reply
 * leaves it alone, and {@code POST /support/tickets/{id}/read} clears it. Ops consequently has no
 * unread indicator on this surface — recorded as debt rather than solved by overloading the column.
 */
@Entity
@Table(name = "support_tickets")
@Getter
public class SupportTicket extends VersionedEntity {

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "subject", nullable = false, updatable = false)
    private String subject;

    @Column(name = "category", updatable = false)
    private String category;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "unread", nullable = false)
    private boolean unread;

    protected SupportTicket() {
        // JPA
    }

    SupportTicket(UUID userId, String subject, String category) {
        this.userId = userId;
        this.subject = subject;
        this.category = category;
        this.status = SupportTicketStatuses.OPEN;
    }

    /** Package-private: only a reply or a read marks the ticket, never a caller directly. */
    void setUnread(boolean unread) {
        this.unread = unread;
    }
}
