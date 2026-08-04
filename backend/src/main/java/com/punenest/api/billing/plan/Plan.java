package com.punenest.api.billing.plan;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A subscription plan on the public price list. Maps {@code plans} (V8), seeded as reference data
 * in {@code R__seed_reference_data.sql}.
 *
 * <p>Read-only from the application's point of view: nothing in the platform creates or edits a
 * plan, because a price list is a business decision made in the back office and a migration, not a
 * runtime write. There is deliberately no setter — when plan administration is needed it belongs
 * under {@code /admin/}, with an audit trail.
 *
 * <p><strong>A {@code price} of zero is a real plan, not a missing one.</strong> "Owner Free" is
 * what every owner is on until they upgrade, and {@link SubscriptionService} keys the entire
 * payment decision off this being zero.
 */
@Entity
@Table(name = "plans")
@Getter
public class Plan extends AuditedEntity {

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "audience")
    private String audience;

    /** Whole rupees for one {@link #billingCycle}. Zero means free. */
    @Column(name = "price", nullable = false)
    private long price;

    @Column(name = "billing_cycle")
    private String billingCycle;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "features", nullable = false)
    private List<String> features = new ArrayList<>();

    protected Plan() {
        // JPA
    }

}
