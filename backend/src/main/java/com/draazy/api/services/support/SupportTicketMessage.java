package com.draazy.api.services.support;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One message on a support ticket. Maps {@code support_ticket_messages} (V8).
 *
 * <p>Shaped exactly like {@code ServiceRequestMessage}, and for the same reason: {@code authorRole}
 * is captured at write time from the authenticated principal, never derived later and never taken
 * from the body, so a reply written by a staffer who is promoted still reads as staff.
 *
 * <p>The V8 {@code attachments} column is not mapped — the contract's {@code Message} response has
 * nowhere to render one, so nothing could read it back.
 */
@Entity
@Table(name = "support_ticket_messages")
@Getter
public class SupportTicketMessage extends BaseEntity {

    @Column(name = "ticket_id", nullable = false, updatable = false)
    private UUID ticketId;

    @Column(name = "author_id", updatable = false)
    private UUID authorId;

    @Column(name = "author_role", updatable = false)
    private String authorRole;

    @Column(name = "body", nullable = false, updatable = false)
    private String body;

    protected SupportTicketMessage() {
        // JPA
    }

    SupportTicketMessage(UUID ticketId, UUID authorId, String authorRole, String body) {
        this.ticketId = ticketId;
        this.authorId = authorId;
        this.authorRole = authorRole;
        this.body = body;
    }

}
