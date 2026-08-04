package com.punenest.api.services.request;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One message on a service request — the customer&lt;-&gt;ops conversation. Maps
 * {@code service_request_messages} (V21).
 *
 * <p>V7 built the aggregate with a timeline and no chat, so "ops asked for the missing NOC" had
 * nowhere to go. See {@link ServiceRequestEvent} for why the two are separate tables.
 *
 * <p><strong>{@code authorRole} is stored, unlike {@code ReviewMessage}'s derived sender side.</strong>
 * That thread has exactly two participants and the side can be derived by comparing the sender to the
 * owner; this one has a customer and a rotating cast of staff, and a message written by a staffer who
 * later becomes an admin must still read as having come from staff. The role is therefore captured at
 * write time from the authenticated principal — never from the body.
 */
@Entity
@Table(name = "service_request_messages")
@Getter
public class ServiceRequestMessage extends BaseEntity {

    @Column(name = "request_id", nullable = false, updatable = false)
    private UUID requestId;

    @Column(name = "author_id", updatable = false)
    private UUID authorId;

    @Column(name = "author_role", updatable = false)
    private String authorRole;

    @Column(name = "body", nullable = false, updatable = false)
    private String body;

    protected ServiceRequestMessage() {
        // JPA
    }

    ServiceRequestMessage(UUID requestId, UUID authorId, String authorRole, String body) {
        this.requestId = requestId;
        this.authorId = authorId;
        this.authorRole = authorRole;
        this.body = body;
    }

}
