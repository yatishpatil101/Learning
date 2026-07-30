package com.punenest.api.catalog.locality;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A curated locality — the geographic reference table the catalogue keys off (V3 {@code localities}).
 *
 * <p><strong>Why the slug is the identity, not the name.</strong> {@code slug} is the table's
 * {@code PRIMARY KEY} and the target of {@code properties.locality_slug} /
 * {@code societies.locality_slug}; {@code name} carries no uniqueness constraint at all. The slug is
 * also the public URL key ({@code /locality/{slug}}), so it is an SEO-load-bearing identifier that
 * must survive a display rename. Keying off {@code name} instead would (a) break every FK on a
 * rename, (b) break bookmarked/indexed URLs, and (c) fail to collapse the spelling variants Indian
 * locality names genuinely have (Hinjawadi/Hinjewadi, Wakad/Wakhad) — which is exactly what
 * {@link LocalityResolver} exists to normalize.
 *
 * <p>Read-only reference data on this slice: rows are seeded/curated
 * ({@code R__seed_reference_data.sql}), never written by application code, so only the columns
 * resolution needs are mapped. Hibernate {@code ddl-auto=validate} ignores unmapped columns.
 */
@Entity
@Table(name = "localities")
public class Locality {

    @Id
    @Column(name = "slug", nullable = false, updatable = false)
    private String slug;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "city", nullable = false)
    private String city;

    @Column(name = "lat")
    private Double lat;

    @Column(name = "lng")
    private Double lng;

    /** Curation flag — an inactive locality must not be a resolution target for new listings. */
    @Column(name = "active", nullable = false)
    private boolean active = true;

    protected Locality() {
        // JPA
    }

    public String getSlug() {
        return slug;
    }

    public String getName() {
        return name;
    }

    public String getCity() {
        return city;
    }

    public Double getLat() {
        return lat;
    }

    public Double getLng() {
        return lng;
    }

    public boolean isActive() {
        return active;
    }
}
