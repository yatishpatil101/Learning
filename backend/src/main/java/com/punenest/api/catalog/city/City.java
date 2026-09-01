package com.punenest.api.catalog.city;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;

/**
 * A city the platform either serves or has been asked for (V3 {@code cities}).
 *
 * <p><strong>Why a table and not a constant.</strong> PuneNest is deliberately one-city at launch,
 * but the city picker still lists the cities it does <em>not</em> serve — that is what makes
 * {@code POST /cities/waitlist} possible, and the waitlist is how the next launch city gets chosen.
 * So "which cities exist" and "which of them are live" are two different questions, and {@link #live}
 * is the answer to the second.
 *
 * <p>Curated reference data. The roster itself is seeded, while {@link #live} is admin-owned at
 * runtime because launching a city is an operational decision. {@code listing_count} is deliberately
 * unmapped: it is one of the unmaintained counters, and this feature computes the count on read
 * instead (see {@code catalog.property.ListingCounts}).
 */
@Entity
@Table(name = "cities")
@Getter
public class City {

    /** URL-safe key and primary key, e.g. {@code pune}. */
    @Id
    @Column(name = "slug", nullable = false, updatable = false)
    private String slug;

    @Column(name = "name", nullable = false)
    private String name;

    /**
     * Whether the platform actually operates here. A non-live city is still listed — it is the entry
     * point to the waitlist — but it must never be presented as somewhere you can transact.
     */
    @Column(name = "live", nullable = false)
    private boolean live;

    /**
     * Launch or pause one curated city from the back office.
     *
     * <p>Package-private on purpose. The rest of this entity has no setters because the roster is
     * seeded, and this one exception exists for exactly one caller — {@code CityAdminService}, in
     * this package. Making it public would put "take a city offline" within reach of any bean that
     * can load a {@code City}, which is the opposite of what the class comment claims.
     */
    void setLive(boolean live) {
        this.live = live;
    }

    protected City() {
        // JPA
    }
}
