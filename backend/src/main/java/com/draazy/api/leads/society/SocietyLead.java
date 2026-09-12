package com.draazy.api.leads.society;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;

/**
 * A society secretary or builder asking to bring a whole building onto the platform (V24).
 *
 * <p><strong>Why this is not a {@code ContactRequest}.</strong> A contact request is a seeker
 * wanting one owner's phone number for one listing; every field on it names a party the platform
 * already knows. This has no listing, no owner and no user account — the person filling in the form
 * is a stranger, and the row's whole life is a sales pipeline. Modelling it as a lead against a
 * null property would make every query in {@code leads} carry a "and not the B2B ones" clause.
 */
@Entity
@Table(name = "society_leads")
@Getter
public class SocietyLead extends AuditedEntity {

    @Column(name = "society_name", nullable = false)
    private String societyName;

    @Column(name = "contact_name", nullable = false)
    private String contactName;

    @Column(name = "mobile", nullable = false)
    private String mobile;

    @Column(name = "units")
    private Integer units;

    @Column(name = "interest")
    private String interest;

    @Column(name = "status", nullable = false)
    private String status = SocietyLeadStatuses.NEW;

    /** Ops working note, replaced by whichever status update last carried one. */
    @Column(name = "note")
    private String note;

    protected SocietyLead() {
    }

    SocietyLead(String societyName, String contactName, String mobile, Integer units,
            String interest) {
        this.societyName = societyName;
        this.contactName = contactName;
        this.mobile = mobile;
        this.units = units;
        this.interest = interest;
    }

    /**
     * Move the lead along the pipeline, optionally attaching a note.
     *
     * <p>Any status may follow any other. A sales pipeline is not a state machine: a lead marked
     * {@code lost} that then answers the phone goes straight back to {@code contacted}, and a
     * server that refuses that teaches ops to keep the real pipeline in a spreadsheet.
     */
    void moveTo(String nextStatus, String nextNote) {
        this.status = nextStatus;
        if (nextNote != null && !nextNote.isBlank()) {
            this.note = nextNote;
        }
    }
}
