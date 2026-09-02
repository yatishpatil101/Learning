package com.draazy.api.billing.boost;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;

/**
 * A purchasable promotion window for one listing. Maps {@code boost_packs} (V8), seeded as
 * reference data.
 *
 * <p>Read-only at runtime, exactly like {@code Plan}: the catalogue is a business decision, not an
 * application write.
 */
@Entity
@Table(name = "boost_packs")
@Getter
public class BoostPack extends AuditedEntity {

    @Column(name = "name", nullable = false)
    private String name;

    /** Whole rupees. */
    @Column(name = "price", nullable = false)
    private long price;

    @Column(name = "duration_days")
    private Integer durationDays;

    @Column(name = "placement")
    private String placement;

    protected BoostPack() {
        // JPA
    }

}
