package com.draazy.api.billing.plan;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A subscription plan on the public price list. Maps {@code plans} (V8), seeded reference data.
 * Rationale: docs/flows/consumer/plans-billing-refer.md.
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

    /**
     * The paywall's real ceiling; {@code null} resolves to the free-tier floor of one, never
     * unlimited. Rationale: docs/flows/consumer/plans-billing-refer.md.
     */
    @Column(name = "listing_limit")
    private Integer listingLimit;

    /** Owner contacts this plan grants, or {@code null} for unlimited / not-applicable. */
    @Column(name = "contact_limit")
    private Integer contactLimit;

    /**
     * Whether this plan lifts the owner-contact ceiling (V91, D31b). Separate column from
     * {@link #contactLimit} which is display-only. Rationale: docs/flows/consumer/plans-billing-refer.md.
     */
    @Column(name = "unlimited_contacts", nullable = false)
    private boolean unlimitedContacts;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "features", nullable = false)
    private List<String> features = new ArrayList<>();

    protected Plan() {
        // JPA
    }

}
