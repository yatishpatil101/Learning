package com.draazy.api.billing.marketplace;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;

/**
 * A paid service on the marketplace price list (packing, painting, legal…). Maps
 * {@code service_offerings} (V8), seeded as reference data.
 *
 * <p>{@code startingPrice} is a <em>from</em> price, not a quote. That is why ordering one does not
 * take payment: the real amount depends on a survey, so {@code ServiceOrder.amount} is filled in by
 * ops afterwards rather than charged at order time.
 *
 * <p>{@code category} mirrors the assisted-service desks in {@code services.Teams}, so an order can
 * be routed to a team that already exists.
 */
@Entity
@Table(name = "service_offerings")
@Getter
public class ServiceOffering extends AuditedEntity {

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "category")
    private String category;

    /** Whole rupees, indicative. Nullable in the schema; zero is a genuinely free service. */
    @Column(name = "starting_price")
    private Long startingPrice;

    @Column(name = "description")
    private String description;

    protected ServiceOffering() {
        // JPA
    }

}
