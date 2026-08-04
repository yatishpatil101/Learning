package com.punenest.api.catalog.city;

import com.punenest.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.Getter;

/**
 * Somebody asking to be told when PuneNest reaches their city (V3 {@code city_waitlist}).
 *
 * <p><strong>Deliberately the smallest record that works.</strong> A contact and a city, and nothing
 * else. The frontend's form also collects a name; it is not stored, because a waitlist needs a way
 * to reach you and a place to reach you about, and a name adds personal data with no use for it.
 * The cheapest way to protect personal data is not to collect it.
 *
 * <p><strong>Uniqueness lives in the database.</strong> {@code uq_city_waitlist_mobile_city} on
 * {@code (mobile, lower(city))}, added in V15. The frontend has always de-duplicated signups, but a
 * client-side rule is not a constraint: two submissions race, both find nothing, and both insert.
 * The index lower-cases the city because it is free text a person typed, and "Mumbai" and "mumbai"
 * are one city.
 */
@Entity
@Table(name = "city_waitlist")
@Getter
public class CityWaitlistEntry extends BaseEntity {

    /** How to reach them. Also format-checked by the column's own CHECK constraint. */
    @Column(name = "mobile", nullable = false, updatable = false)
    private String mobile;

    /** Free text: by definition a city we do not serve, so it cannot be an FK to {@code cities}. */
    @Column(name = "city", nullable = false, updatable = false)
    private String city;

    @Column(name = "email")
    private String email;

    protected CityWaitlistEntry() {
        // JPA. Rows are created by CityWaitlistRepository#insertIfAbsent, not by this constructor —
        // the mapping exists so ddl-auto=validate still checks the table, and so reads are typed.
    }

}
