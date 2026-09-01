package com.punenest.api.engagement.society;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A community-proposed fact about a society, waiting for ops to decide.
 *
 * <p>Three features share this row — a detail suggestion, the resident WhatsApp invite, and a
 * corrected map pin — because they are one lifecycle wearing three names: somebody who knows the
 * building proposes a fact, ops screen it, and on approval it is written onto the society itself.
 * Splitting them would have produced three copies of the "already decided, do not double-write"
 * rule, and a copy that drifts silently reverts an operator's decision.
 *
 * <p><strong>This row is the audit trail, not what the hub reads.</strong> An approved proposal's
 * value lives on {@code societies}; nothing renders a society's builder by joining back through
 * here. That is deliberate — the browser build kept an "overlay" keyed on the slug precisely
 * because it could not write the catalogue, and an overlay that outlives the reason for it becomes
 * a second, disagreeing copy of every fact it shadows.
 *
 * <p>Only one field per kind is nullable-by-meaning rather than nullable-by-kind, and the database
 * check constraint is two-sided about it: a proposal carries what its kind means and nothing
 * belonging to another kind. A WhatsApp invite riding along on a detail suggestion would be
 * approved by an operator reviewing a builder's name — which is exactly the review the invite is
 * supposed to get, and exactly the review it would then never get.
 */
@Entity
@Table(name = "society_proposals")
@Getter
public class SocietyProposal extends AuditedEntity {

    @Column(name = "society_id", nullable = false, updatable = false)
    private UUID societyId;

    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    /** {@code details} / {@code whatsapp} / {@code location}; see {@link SocietyProposalKinds}. */
    @Column(name = "kind", nullable = false, updatable = false)
    private String kind;

    /** {@code pending} / {@code approved} / {@code rejected}. */
    @Column(name = "status", nullable = false)
    private String status = SocietyProposalStatuses.PENDING;

    @Column(name = "builder")
    private String builder;

    /**
     * Year built or possession year.
     *
     * <p>Named {@code buildYear} rather than {@code year} because {@code year} is a reserved word
     * in enough SQL dialects to be worth avoiding, and because a bare {@code year} on a row that
     * also has {@code created_at} reads as a date part of it.
     */
    @Column(name = "build_year")
    private Integer buildYear;

    @Column(name = "towers")
    private Integer towers;

    @Column(name = "units")
    private Integer units;

    @Column(name = "maintenance_per_sqft")
    private BigDecimal maintenancePerSqft;

    /**
     * Null means "the author did not propose an amenity list"; an empty list means "the author
     * says this society has none". The difference decides whether approval overwrites the
     * catalogue's list or leaves it alone, so it cannot be flattened.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "amenities")
    private List<String> amenities;

    /** A {@code https://chat.whatsapp.com/…} invite. Format is enforced in the service. */
    @Column(name = "invite_url")
    private String inviteUrl;

    @Column(name = "lat")
    private Double lat;

    @Column(name = "lng")
    private Double lng;

    /** The only Google Place field persisted besides the coordinates, per the Places terms. */
    @Column(name = "place_id")
    private String placeId;

    /** What the author typed or picked, kept so an operator can see what they thought they set. */
    @Column(name = "label")
    private String label;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decided_at")
    private Instant decidedAt;

    protected SocietyProposal() {
        // JPA
    }

    SocietyProposal(UUID societyId, UUID authorId, String kind) {
        this.societyId = societyId;
        this.authorId = authorId;
        this.kind = kind;
    }

    void details(String builder, Integer buildYear, Integer towers, Integer units,
            BigDecimal maintenancePerSqft, List<String> amenities) {
        this.builder = builder;
        this.buildYear = buildYear;
        this.towers = towers;
        this.units = units;
        this.maintenancePerSqft = maintenancePerSqft;
        this.amenities = amenities;
    }

    void invite(String inviteUrl) {
        this.inviteUrl = inviteUrl;
    }

    void location(Double lat, Double lng, String placeId, String label) {
        this.lat = lat;
        this.lng = lng;
        this.placeId = placeId;
        this.label = label;
    }

    void decide(String status, UUID decidedBy, Instant at) {
        this.status = status;
        this.decidedBy = decidedBy;
        this.decidedAt = at;
    }
}
