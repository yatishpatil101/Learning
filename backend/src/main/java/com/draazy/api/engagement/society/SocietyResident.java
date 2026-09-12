package com.draazy.api.engagement.society;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * One person's claimed tenure of one flat (V101 {@code society_residents}).
 *
 * <p><strong>What this row buys.</strong> It is the difference between "somebody on the internet
 * says the lift is broken" and "B/704 says the lift is broken". Every write on the society hub that
 * is not a review — the notice board, Q&A answers, the WhatsApp group link — is gated on a verified
 * row here, because those surfaces are read by people deciding where to live and an unverified
 * poster is indistinguishable from a broker.
 *
 * <p><strong>{@code unitKey} is stored, not derived.</strong> {@code ux_society_residents_unit_verified}
 * is built on it, and an index over an expression that has to agree with normalisation code in two
 * languages is a trap. {@link #normaliseUnit} is the single producer.
 *
 * <p><strong>{@code flagged} is advisory, not a refusal.</strong> A flat with a verified holder that
 * somebody else applies for is usually a handover, occasionally an impostor, and the server cannot
 * tell which. So the request is accepted, marked, and put in front of the reviewer who can. The
 * refusal happens at the decision instead — {@code ux_society_residents_unit_verified} makes two
 * simultaneous approvals impossible however carefully the service is written.
 */
@Entity
@Table(name = "society_residents")
@Getter
public class SocietyResident extends AuditedEntity {

    @Column(name = "society_id", nullable = false, updatable = false)
    private UUID societyId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "wing")
    private String wing;

    @Column(name = "flat")
    private String flat;

    @Column(name = "unit_key", nullable = false)
    private String unitKey;

    @Column(name = "relation", nullable = false)
    private String relation = SocietyResidentRelations.RESIDENT;

    @Column(name = "status", nullable = false)
    private String status = SocietyResidentStatuses.PENDING;

    @Column(name = "assigned_to", nullable = false)
    private String assignedTo = SocietyResidentQueues.OPS;

    /** {@code "conflict"} when another verified resident already holds this unit; else null. */
    @Column(name = "flagged")
    private String flagged;

    @Column(name = "note")
    private String note;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decided_by")
    private UUID decidedBy;

    protected SocietyResident() {
    }

    SocietyResident(UUID societyId, UUID userId, String wing, String flat, String relation,
            String note, String assignedTo, boolean conflicting) {
        this.societyId = societyId;
        this.userId = userId;
        applyUnit(wing, flat, relation, note, assignedTo, conflicting);
    }

    /**
     * Re-applying replaces the standing request rather than queueing a second.
     *
     * <p>{@code ux_society_residents_person} makes that the only possibility, and it is the right
     * one: somebody who typed B/704 when they meant B/740 needs to correct it, and a queue that
     * accumulates every typo is a queue nobody clears.
     */
    void reapply(String nextWing, String nextFlat, String nextRelation, String nextNote,
            String queue, boolean conflicting) {
        applyUnit(nextWing, nextFlat, nextRelation, nextNote, queue, conflicting);
        this.status = SocietyResidentStatuses.PENDING;
        this.decidedAt = null;
        this.decidedBy = null;
    }

    private void applyUnit(String nextWing, String nextFlat, String nextRelation, String nextNote,
            String queue, boolean conflicting) {
        this.wing = nextWing;
        this.flat = nextFlat;
        this.unitKey = normaliseUnit(nextWing, nextFlat);
        this.relation = nextRelation;
        this.note = nextNote;
        this.assignedTo = queue;
        this.flagged = conflicting ? SocietyResidentFlags.CONFLICT : null;
    }

    void decide(String nextStatus, UUID by) {
        this.status = nextStatus;
        this.decidedAt = Instant.now();
        this.decidedBy = by;
        if (SocietyResidentStatuses.VERIFIED.equals(nextStatus)) {
            // A verified row IS the resolution of the conflict it was flagged for; leaving the mark
            // on would make the reviewer's own decision look unresolved forever.
            this.flagged = null;
        }
    }

    public boolean isVerified() {
        return SocietyResidentStatuses.VERIFIED.equals(status);
    }

    /**
     * Wing and flat collapsed into one comparable token: {@code ("B", "704") -> "B704"}.
     *
     * <p>Case and whitespace are removed because "b 704", "B-704" and "B704" are one flat, and a
     * uniqueness rule that can be defeated by a space is not a uniqueness rule. The separator
     * characters go with them — there is no format a society agrees on.
     */
    public static String normaliseUnit(String wing, String flat) {
        String joined = (wing == null ? "" : wing) + (flat == null ? "" : flat);
        return joined.toUpperCase(java.util.Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }
}
