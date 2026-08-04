package com.punenest.api.services.ticket;

import com.punenest.api.common.persistence.VersionedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One item on the ops board — a lead, an enquiry, a piece of work somebody has to pick up. Maps
 * {@code tickets} (V7).
 *
 * <p><strong>How this differs from a {@code ServiceRequest}</strong>, since the two look alike: a
 * service request is a workflow with a deliverable and a customer sign-off, and only the customer
 * can end it. A ticket is a work item — it has a team, a priority and internal notes, and ops closes
 * it. The board is where things arrive; the workflow is where the ones that need paperwork go.
 *
 * <p><strong>{@code customer} and {@code mobile} are denormalised on purpose.</strong> V7 allows a
 * ticket with no {@code requester_id} because ops raise them for guests who have never signed up. A
 * ticket raised through the API always has a requester, and these two are copied from that user at
 * write time so the board reads the same either way.
 */
@Entity
@Table(name = "tickets")
@Getter
public class Ticket extends VersionedEntity {

    @Column(name = "subject", nullable = false)
    private String subject;

    /** One of {@link com.punenest.api.security.Teams}; the V7 CHECK rejects anything else. */
    @Column(name = "team")
    @Setter
    private String team;

    @Column(name = "priority", nullable = false)
    @Setter
    private String priority = TicketPriorities.MEDIUM;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = TicketStatuses.OPEN;

    @Column(name = "property_id")
    private UUID propertyId;

    @Column(name = "requester_id", updatable = false)
    private UUID requesterId;

    @Column(name = "assignee_id")
    @Setter
    private UUID assigneeId;

    /** Service-catalogue display name. Ops-owned: not settable through {@code TicketCreate}. */
    @Column(name = "service")
    private String service;

    @Column(name = "customer")
    private String customer;

    @Column(name = "mobile")
    private String mobile;

    /** Deal value in paise, if ops have estimated one. Ops-owned. */
    @Column(name = "value")
    private Long value;

    @Column(name = "detail")
    private String detail;

    protected Ticket() {
        // JPA
    }

    public Ticket(String subject, String team, String priority, UUID propertyId, UUID requesterId,
            String customer, String mobile, String detail) {
        this.subject = subject;
        this.team = team;
        if (priority != null) {
            this.priority = priority;
        }
        this.propertyId = propertyId;
        this.requesterId = requesterId;
        this.customer = customer;
        this.mobile = mobile;
        this.detail = detail;
    }

}
