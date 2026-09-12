package com.draazy.api.services.support;

import com.draazy.api.common.persistence.VersionedEntity;
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
 * <p><strong>The read model has two sides and two columns (D50, V53).</strong> {@code unread} is the
 * raiser's: "a support reply the ticket's owner has not read". {@code staffUnread} is the desk's: "a
 * customer message nobody on the desk has read". Each is set by the <em>other</em> party writing and
 * cleared by <em>its own</em> party reading, so neither side can mark the other as caught up.
 *
 * <p>The second column exists because the first could not be made to do both jobs. One boolean has
 * to mean one thing; the moment it means "somebody has something to read", the customer's badge
 * lights up on their own message and either party's read clears the other's signal. That is why this
 * was recorded as debt rather than patched by reinterpreting the column.
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

    /** The desk's side: a customer message no staff member has read. Column added in V53. */
    @Column(name = "staff_unread", nullable = false)
    private boolean staffUnread;

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

    /** Package-private, for the same reason as {@link #setUnread(boolean)}. */
    void setStaffUnread(boolean staffUnread) {
        this.staffUnread = staffUnread;
    }
}
