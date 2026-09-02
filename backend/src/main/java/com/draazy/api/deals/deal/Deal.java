package com.draazy.api.deals.deal;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * The deal aggregate — the lifecycle state of a listing's transaction (active → reserved → closed).
 * Maps {@code deals} (V5, extended by V11).
 *
 * <p><strong>Lazy create (reconciliation item d).</strong> The mock represents {@code active} as
 * "no stored row"; the V5 DDL defaults status to {@code active}. To avoid a dead row per listing,
 * rows are created lazily on the first {@code reserve}/{@code close}/{@code addParty}. A
 * synthesized active Deal is returned from {@code getDeal} when no row exists. The unique index
 * {@code uq_deals_property} guarantees a concurrent lazy create cannot fork.
 *
 * <p><strong>Ids, not associations.</strong> {@code propertyId} and {@code counterpartyId} are
 * plain UUID columns — no {@code @ManyToOne} graphs. This entity lives in the {@code deals}
 * context while its targets are in {@code catalog} and {@code identity}; an object reference
 * would hard-wire a cross-context join.
 *
 * <p><strong>Money is {@code Long}.</strong> {@code agreed_price} is {@code bigint} (V5);
 * the contract's {@code Money} type is {@code int64} (whole INR). Never float/double/BigDecimal.
 */
@Entity
@Table(name = "deals")
@Getter
public class Deal extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** {@code buy} or {@code rent} — from the listing's deal intent. */
    @Column(name = "deal", nullable = false)
    private String deal;

    /** The registered counterparty, or {@code null} for an off-platform close. */
    @Column(name = "counterparty_id")
    @Setter
    private UUID counterpartyId;

    /** Raw mobile the owner typed on close; stored as the last 10 digits. */
    @Column(name = "counterparty_mobile")
    @Setter
    private String counterpartyMobile;

    /** Whole INR — the agreed transaction price, set on close. */
    @Column(name = "agreed_price")
    @Setter
    private Long agreedPrice;

    /** One of {@link DealStatuses}; the V5 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    @Setter
    private String status = DealStatuses.ACTIVE;

    @Column(name = "closed_at")
    @Setter
    private Instant closedAt;

    /** Free-text note the owner entered on close. */
    @Column(name = "note")
    @Setter
    private String note;

    protected Deal() {
        // JPA
    }

    public Deal(UUID propertyId, String dealIntent) {
        this.propertyId = propertyId;
        this.deal = dealIntent;
    }

}
