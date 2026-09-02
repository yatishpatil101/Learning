package com.draazy.api.catalog.locality;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

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
 * <p><strong>Curated reference data, now curated through the API.</strong> Until the back-office
 * localities console had a server behind it these rows were written only by
 * {@code R__DML_seed_reference_data.sql} and the entity had no setters at all. It has them now, on the
 * editable fields and nowhere else — {@link #slug} is still {@code updatable = false} and has no
 * setter, because it is the {@code PRIMARY KEY} three foreign keys and every public URL point at.
 * Renaming a locality is a {@code name} edit; it is never a slug edit, and there is no route that
 * offers one.
 *
 * <p>Retirement is {@code active = false}, never {@code DELETE}. Rows in {@code properties} and
 * {@code societies} reference this slug, so a delete is either an FK violation or, worse, a cascade
 * that takes listings with it.
 *
 * <p><strong>{@code listing_count} is deliberately unmapped.</strong> It is one of the stored
 * counters no code has ever maintained, and it counts <em>every</em> property while every surface
 * that displays it means approved and unarchived ones. The count is computed on read instead
 * ({@code catalog.property.ListingCounts}); leaving the column off the entity is what makes reading
 * the wrong number impossible rather than merely discouraged.
 */
@Entity
@Table(name = "localities")
@Getter
public class Locality {

    @Id
    @Column(name = "slug", nullable = false, updatable = false)
    private String slug;

    @Setter
    @Column(name = "name", nullable = false)
    private String name;

    @Setter
    @Column(name = "city", nullable = false)
    private String city;

    /** Average asking rent per sq ft. {@code numeric}, so {@link BigDecimal} — never a float. */
    @Setter
    @Column(name = "avg_rent_psf")
    private BigDecimal avgRentPsf;

    @Setter
    @Column(name = "avg_buy_psf")
    private BigDecimal avgBuyPsf;

    @Setter
    @Column(name = "rate_per_sqft")
    private BigDecimal ratePerSqft;

    /** Absolute average monthly rent in whole rupees. */
    @Setter
    @Column(name = "avg_rent")
    private Long avgRent;

    /** Demand index 0-100; the column's CHECK constraint enforces the range. */
    @Setter
    @Column(name = "demand")
    private Integer demand;

    /** {@code Buy} / {@code Rent} / {@code Both} — constrained by the column, not by an enum here. */
    @Setter
    @Column(name = "focus")
    private String focus;

    @Setter
    @Column(name = "lat")
    private Double lat;

    @Setter
    @Column(name = "lng")
    private Double lng;

    /** Curation flag — an inactive locality must not be a resolution target for new listings. */
    @Setter
    @Column(name = "active", nullable = false)
    private boolean active = true;

    /**
     * Editorial copy for the locality page.
     *
     * <p>This and the three fields below are empty in every seeded row today. The frontend's
     * locality page currently gets its narrative from a hard-coded {@code src/data/localityIntel.js},
     * which is a <em>different</em> model — demand as a text band, connectivity as
     * (place, icon, distance) triples, plus sub-scores the contract has no fields for. Reshaping it
     * server-side would mean inventing content rather than moving it, so the columns ship to the
     * contract's shape and stay empty until somebody authors them.
     */
    @Column(name = "about")
    private String about;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "connectivity", nullable = false)
    private List<String> connectivity = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "highlights", nullable = false)
    private List<String> highlights = new ArrayList<>();

    /** Monthly price history. Stored as jsonb; the element shape is the contract's, verbatim. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "price_trends", nullable = false)
    private List<PriceTrendPoint> priceTrends = new ArrayList<>();

    protected Locality() {
        // JPA
    }

    /**
     * Coin a new locality. Package-private: {@link LocalityAdminService} is the only writer, and it
     * is the thing that knows the slug is unique before it gets here.
     *
     * <p>The three arguments are exactly the columns declared {@code NOT NULL} with no default.
     * Everything else — the price signals, the coordinates, the editorial copy — is optional and
     * arrives through the setters, because a locality is usually created the day it is noticed and
     * priced weeks later.
     */
    Locality(String slug, String name, String city) {
        this.slug = slug;
        this.name = name;
        this.city = city;
    }

}
