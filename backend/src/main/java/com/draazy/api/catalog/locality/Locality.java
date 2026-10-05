package com.draazy.api.catalog.locality;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import lombok.Getter;

/** Slug is the stable identity; names are display text and not unique. */
@Entity
@Table(name = "localities")
@Getter
public class Locality {

    @Id
    @Column(name = "slug", nullable = false, updatable = false)
    private String slug;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "city", nullable = false)
    private String city;

    /** Average asking rent per sq ft. {@code numeric}, so {@link BigDecimal} — never a float. */
    @Column(name = "avg_rent_psf")
    private BigDecimal avgRentPsf;

    @Column(name = "avg_buy_psf")
    private BigDecimal avgBuyPsf;

    @Column(name = "rate_per_sqft")
    private BigDecimal ratePerSqft;

    @Column(name = "avg_rent")
    private Long avgRent;

    @Column(name = "demand")
    private Integer demand;

    /** {@code Buy} / {@code Rent} / {@code Both} — constrained by the column, not by an enum here. */
    @Column(name = "focus")
    private String focus;

    @Column(name = "lat")
    private Double lat;

    @Column(name = "lng")
    private Double lng;

    /** Curation flag — an inactive locality must not be a resolution target for new listings. */
    @Column(name = "active", nullable = false)
    private boolean active = true;

    @Column(name = "registration_body", nullable = false, insertable = false, updatable = false)
    private String registrationBody;

    protected Locality() {
        // JPA
    }
}
