package com.draazy.api.deals.deal;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "deals")
@Getter
public class Deal extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    @Column(name = "deal", nullable = false)
    private String deal;

    @Column(name = "counterparty_id")
    @Setter
    private UUID counterpartyId;

    @Column(name = "counterparty_mobile")
    @Setter
    private String counterpartyMobile;

    @Column(name = "agreed_price")
    @Setter
    private Long agreedPrice;

    @Column(name = "status", nullable = false)
    @Setter
    private String status = DealStatuses.ACTIVE;

    @Column(name = "closed_at")
    @Setter
    private Instant closedAt;

    @Column(name = "note")
    @Setter
    private String note;

    protected Deal() {

    }

    public Deal(UUID propertyId, String dealIntent) {
        this.propertyId = propertyId;
        this.deal = dealIntent;
    }

    }
