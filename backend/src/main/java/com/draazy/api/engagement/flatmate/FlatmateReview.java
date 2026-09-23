package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Embedded;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** An Ops agreement review (V27 {@code flatmate_reviews}). A CHECK constraint keeps exactly one
 * of {@link #roomId}/{@link #groupId} populated and agreeing with {@link #kind}. */
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

    @Column(name = "tenancy_property_id")
    private UUID tenancyPropertyId;

    /** jsonb rather than columns because nothing queries inside it — Ops reads it whole. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "agreement_doc")
    private Map<String, Object> agreementDoc;

    /** Columns rather than keys in {@link #agreementDoc} because {@code validTill} is queried. */
    @Embedded
    private AgreementRegistration agreement = new AgreementRegistration();

    /** Hibernate hydrates an all-null embeddable as null (every row before V28); the empty value
     * keeps {@code complete()} and {@code expiredOn()} answerable for those rows. */
    AgreementRegistration getAgreement() {
        return agreement == null ? new AgreementRegistration() : agreement;
    }

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
            Map<String, Object> agreementDoc, AgreementRegistration agreement,
            UUID tenancyPropertyId) {
        this.kind = kind;
        this.roomId = roomId;
        this.groupId = groupId;
        this.hostId = hostId;
        this.address = address;
        this.tier = tier;
        this.flagForReview = flagForReview;
        this.ownerConsent = ownerConsent;
        this.agreementDoc = agreementDoc;
        this.agreement = agreement;
        this.tenancyPropertyId = tenancyPropertyId;
    }

    void decide(String decision, String why, UUID decider) {
        this.status = decision;
        this.reason = why;
        this.decidedBy = decider;
    }

    /** Re-opened in place because {@code uq_flatmate_reviews_room} and its group twin allow one row
     * per target; clearing the verdict also drops the badge, which both feeds derive from it. */
    void reopenAfterEdit(String address, String tier, boolean flagForReview, boolean ownerConsent,
            Map<String, Object> agreementDoc, AgreementRegistration agreement,
            UUID tenancyPropertyId) {
        this.address = address;
        this.tier = tier;
        this.flagForReview = flagForReview;
        this.ownerConsent = ownerConsent;
        this.agreementDoc = agreementDoc;
        this.agreement = agreement;
        this.tenancyPropertyId = tenancyPropertyId;
        this.status = FlatmateVocabulary.STATUS_PENDING;
        this.reason = null;
        this.decidedBy = null;
    }

    void recordOwnerConsent() {
        this.ownerConsent = true;
    }

    /** One predicate for both {@code requireConsentToApprove} and the unsupervised
     * {@code FlatmateTrustReconciler} sweep, so a new condition cannot be enforced on only one. */
    boolean badgeable() {
        return ownerConsent && getAgreement().complete();
    }

    /** Reuses {@code rejected} rather than a status every consumer would have to learn. The DB
     * requires a reason on rejection; {@code decidedBy} stays null because no person decided. */
    void expire(LocalDate on) {
        this.status = FlatmateVocabulary.STATUS_REJECTED;
        this.reason = "The registered agreement backing this post expired on " + on
                + ". Upload the renewed agreement to get the badge back.";
        this.decidedBy = null;
    }
}
