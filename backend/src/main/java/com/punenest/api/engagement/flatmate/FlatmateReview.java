package com.punenest.api.engagement.flatmate;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An Ops agreement review (V27 {@code flatmate_reviews}).
 *
 * <p>"I have a registered rent agreement" is self-declared, so a tenant-tier post does not earn its
 * badge until a person has looked at the document. Owner-tier posts never enter this queue: they are
 * vetted through their parent listing's own documents, and reviewing the same evidence twice is
 * theatre that costs Ops real time.
 *
 * <p>Unlike {@link FlatmateRequest}, this genuinely does use two nullable foreign keys rather than a
 * polymorphic id — the queue joins to both tables to render an address, so the keys have to be real
 * relations. A CHECK constraint keeps exactly one of them populated and agreeing with {@link #kind}.
 */
@Entity
@Table(name = "flatmate_reviews")
@Getter
public class FlatmateReview extends AuditedEntity {

    @Column(name = "kind", nullable = false, updatable = false)
    private String kind;

    @Column(name = "room_id", updatable = false)
    private UUID roomId;

    @Column(name = "group_id", updatable = false)
    private UUID groupId;

    @Column(name = "host_id", nullable = false, updatable = false)
    private UUID hostId;

    @Column(name = "address")
    private String address;

    @Column(name = "tier", nullable = false)
    private String tier;

    /** A different host already claimed this address. Fuzzy match, so it flags rather than blocks. */
    @Column(name = "flag_for_review", nullable = false)
    private boolean flagForReview = false;

    @Column(name = "owner_consent", nullable = false)
    private boolean ownerConsent = false;

    /**
     * The uploaded agreement as metadata plus a URL. Stored as jsonb rather than columns because
     * nothing queries inside it — Ops reads it whole, and it is the one field whose shape is likely
     * to change when storage does.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "agreement_doc")
    private Map<String, Object> agreementDoc;

    @Column(name = "status", nullable = false)
    private String status = FlatmateVocabulary.STATUS_PENDING;

    /** Required on reject and shown to the host — a rejection nobody can act on is a dead end. */
    @Column(name = "reason")
    private String reason;

    @Column(name = "decided_by")
    private UUID decidedBy;

    protected FlatmateReview() {
    }

    FlatmateReview(String kind, UUID roomId, UUID groupId, UUID hostId, String address,
            String tier, boolean flagForReview, boolean ownerConsent,
            Map<String, Object> agreementDoc) {
        this.kind = kind;
        this.roomId = roomId;
        this.groupId = groupId;
        this.hostId = hostId;
        this.address = address;
        this.tier = tier;
        this.flagForReview = flagForReview;
        this.ownerConsent = ownerConsent;
        this.agreementDoc = agreementDoc;
    }

    void decide(String decision, String why, UUID decider) {
        this.status = decision;
        this.reason = why;
        this.decidedBy = decider;
    }

    /**
     * Re-open this review because the host edited the post it describes.
     *
     * <p>There is one review row per target — {@code uq_flatmate_reviews_room} and its group twin
     * make sure of it — so an edit cannot file a second one. Before this method it tried to, and
     * the constraint turned every edit of an agreement-backed post into a 409 the host could do
     * nothing about.
     *
     * <p>Re-opening rather than leaving the old verdict standing, because the verdict was about
     * facts the edit may have just changed: the address, what the host claims to be, and the
     * document backing the claim. A moderator's "yes" to the old address is not a "yes" to a new
     * one.
     *
     * <p>Note what this does <em>not</em> touch: the badge. Ops moving a review to approved is
     * what grants the badge, and nothing here revokes it — the post keeps the trust it earned
     * until a moderator reads the edit and says otherwise. That is the same asymmetry the whole
     * feature runs on: publication and verification are separate axes, and an edit should not
     * punish a host by silently stripping a badge for fixing a typo.
     */
    void reopenAfterEdit(String address, String tier, boolean flagForReview, boolean ownerConsent,
            Map<String, Object> agreementDoc) {
        this.address = address;
        this.tier = tier;
        this.flagForReview = flagForReview;
        this.ownerConsent = ownerConsent;
        this.agreementDoc = agreementDoc;
        this.status = FlatmateVocabulary.STATUS_PENDING;
        this.reason = null;
        this.decidedBy = null;
    }
}
