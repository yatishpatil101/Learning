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
 * A subscription plan on the public price list. Maps {@code plans} (V8), seeded as reference data
 * in {@code R__DML_seed_reference_data.sql}.
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

    /**
     * Live listings this plan allows, or {@code null} for no cap. The paywall's real ceiling, kept as
     * a number rather than parsed out of {@link #features} prose (D109); {@code null} is a genuine
     * answer meaning the limit does not apply to this plan's audience.
     */
    @Column(name = "listing_limit")
    private Integer listingLimit;

    /** Owner contacts this plan grants, or {@code null} for unlimited / not-applicable (see D109). */
    @Column(name = "contact_limit")
    private Integer contactLimit;

    /**
     * Whether this plan lifts the owner-contact ceiling entirely (V91, D31b).
     *
     * <p>A separate column from {@link #contactLimit} rather than a convention over it, because that
     * one is nullable and its own comment admits {@code null} means "unlimited <em>or</em>
     * not-applicable" — two different answers stored identically, which is exactly the question an
     * entitlement check asks. {@code contactLimit} stayed as it was: it is display data on the
     * pricing page, and nothing reads it to decide anything.
     *
     * <p>{@code false} on Owner Free and {@code true} on the three priced plans, which is precisely
     * what the browser enforced before the quota moved server-side. Set from the seeded ids rather
     * than from {@code price > 0}: "priced" and "unlimited" coincide today but are two decisions, and
     * a promotional free month must not withdraw the entitlement it is promoting.
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
