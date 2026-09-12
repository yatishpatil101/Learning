package com.draazy.api.moderation.duplicate;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An operator's verdict that a derived duplicate cluster is a coincidence. Maps
 * {@code listing_duplicate_dismissals} (V122).
 *
 * <p>Extends {@link BaseEntity}, not {@code AuditedEntity}: a dismissal is created and never
 * updated, so {@code created_at} is the moment of dismissal and an {@code updated_at} would be a
 * column nothing could ever move.
 *
 * <p><strong>This records that a question was answered, not that the listings are unrelated.</strong>
 * The cluster is still derived from live signals on every request; all this does is stop a settled
 * set from being re-asked. If the set changes — a third listing collides, or a member is archived —
 * the signature changes with it and the new set surfaces, because the operator's verdict was about
 * the set they saw and not about any listing individually.
 */
@Entity
@Table(name = "listing_duplicate_dismissals")
@Getter
public class ListingDuplicateDismissal extends BaseEntity {

    /**
     * sha-256 hex of the sorted member ids — see {@link DuplicateClusterSignature}.
     *
     * <p>{@code updatable = false} because changing it would silently re-point an operator's verdict
     * at a set they never looked at.
     */
    @Column(name = "cluster_signature", nullable = false, updatable = false)
    private String clusterSignature;

    /**
     * The readable form of the same fact, for whoever is debugging "why is this cluster back".
     *
     * <p>Written, never queried. The signature is the key; a second lookup path over the same data
     * is a second thing to keep in step.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "member_ids", nullable = false, updatable = false, columnDefinition = "jsonb")
    private List<String> memberIds;

    /** Always from the JWT. */
    @Column(name = "dismissed_by", nullable = false, updatable = false)
    private UUID dismissedBy;

    protected ListingDuplicateDismissal() {
        // JPA
    }

    public ListingDuplicateDismissal(String clusterSignature, List<String> memberIds,
            UUID dismissedBy) {
        this.clusterSignature = clusterSignature;
        this.memberIds = memberIds;
        this.dismissedBy = dismissedBy;
    }
}
