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
 * ticket raised through the API used to always have a requester, and these two are copied from that
 * user at write time so the board reads the same either way.
 *
 * <p><strong>That "always" stopped being true with D4.</strong> {@code POST /service-waitlist} is
 * unauthenticated, so its rows carry a null {@code requesterId} and a {@code mobile} nobody has
 * verified — see {@link TicketService#joinWaitlist} for why the number is deliberately <em>not</em>
 * looked up among users to fill the column in. The denormalisation is what makes that row readable
 * at all: without it, a ticket with no requester would have no name and no number on the board, and
 * a waitlist entry the desk cannot call back is not a lead. Anything reasoning about who raised a
 * ticket must treat {@code requesterId == null} as "a stranger, unverified", not as "seed data".
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

    /**
     * Deal value. <strong>Nothing writes this column, and nothing is going to.</strong>
     *
     * <p>This Javadoc used to open "Deal value, if ops have estimated one. Ops-owned", which was
     * the second false claim it carried. Ops cannot own it and never could: {@code TicketCreate}
     * drops the field by design, {@code TicketUpdate} has never had it, and the seed does not set
     * it — the column V7 declared in 2024 has been filled by nothing, ever. "Ops-owned" described
     * an intention nobody implemented, in the grammar of a statement about how the system works.
     *
     * <p>It stays unwritten deliberately. A deal value belongs to the deal, and {@link
     * com.punenest.api.deals.deal.Deal} already holds {@code agreedPrice} for exactly that. Adding
     * the field to {@code TicketUpdate} would have been the smaller change and the wrong one: it
     * would make the support board the system of record for a number the board does not otherwise
     * reason about, and would leave two candidate answers to "what did this close at" the moment
     * the deals screen grew its own.
     *
     * <p>The column is kept rather than dropped because dropping it is a migration that buys
     * nothing: it is nullable, it is never read into a decision, and its name is the clearest
     * available place to record why it is empty.
     *
     * <p><strong>Whole rupees, and this Javadoc used to say otherwise.</strong> It read "deal value
     * in paise", which is wrong and is the only place in the codebase that claims it: every other
     * money field here is documented "whole rupees" ({@code BoostPack}, {@code ServiceOffering},
     * {@code ServiceOrder}, {@code Plan}, {@code Referral}, {@code FeeResponse}), the contract types
     * money as {@code int64} rupees, and the ops board renders this column straight through
     * {@code fmtINR}, which formats its argument as rupees. Nothing converted, so the claim was
     * never true — it survived because no ticket has ever carried a value: the column is unwritten
     * in the seed and {@code TicketCreate} refuses to set it, so the units were never exercised.
     * A comment that is only wrong where it is never read is still the comment the next person
     * writes code against.
     */
    @Column(name = "value")
    private Long value;

    /**
     * What the customer accepted, in whole rupees, when the ticket came off a priced flow.
     * Client-set at creation and never afterwards — a quote is a fact about a moment, and a quote
     * that can be edited is evidence of nothing.
     *
     * <p>Distinct from {@link #getValue()} on purpose: this is what was agreed before ops saw the
     * job, that is what the desk expects to bill after. Their disagreement is the signal, so one
     * column cannot hold both.
     */
    @Column(name = "quoted_value", updatable = false)
    private Long quotedValue;

    @Column(name = "detail")
    private String detail;

    protected Ticket() {
        // JPA
    }

    public Ticket(String subject, String team, String priority, UUID propertyId, UUID requesterId,
            String customer, String mobile, String detail, Long quotedValue) {
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
        this.quotedValue = quotedValue;
    }

}
