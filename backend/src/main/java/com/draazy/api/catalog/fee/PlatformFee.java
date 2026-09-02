package com.draazy.api.catalog.fee;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;

/**
 * The published cost of doing a deal on the platform, one row per deal intent (V1
 * {@code platform_fees}).
 *
 * <p><strong>This is not the platform's price list.</strong> The two are easy to confuse because
 * both are called "fees". This table answers "what will this <em>transaction</em> cost me?" —
 * brokerage, platform fee, stamp duty, registration, GST — and is public, because a buyer comparing
 * Draazy against a broker needs the number before signing up. The price list (plan prices, the
 * rent-payment convenience percentage) lives in {@code settings('fees')}, is read server-side by
 * {@code common.settings.PlatformSettings}, and is published by the admin settings endpoint. They
 * are deliberately kept apart: one is a marketing promise, the other is operational configuration.
 *
 * <p>Reference data — seeded by {@code R__DML_seed_reference_data.sql}, never written by application
 * code, so no setters. Only the columns the contract's {@code Fees} schema names are mapped;
 * {@code ddl-auto=validate} ignores the rest.
 *
 * <p><strong>{@link #stampDuty} and {@link #registration} are nullable, and null is meaningful</strong>
 * (D163, V52). It says "this line is not a flat figure — it is computed per agreement", which is the
 * literal truth for a leave-and-licence: stamp duty is 0.25% of a consideration built from the rent,
 * the term and the deposit, and the registration fee depends on whether the registering body is
 * municipal or rural. Seeding either as a number would be right for one tenancy and wrong for every
 * other, and this table is read by the public. The arithmetic lives in
 * {@link LeaveAndLicenceCharges}; a caller that sums this row must decide what an absent line means
 * rather than coercing it to zero.
 */
@Entity
@Table(name = "platform_fees")
@Getter
public class PlatformFee {

    /**
     * The deal intent this breakdown applies to ({@code buy} or {@code rent}) — and the primary key,
     * because there is exactly one published breakdown per intent.
     */
    @Id
    @Column(name = "deal", nullable = false, updatable = false)
    private String deal;

    @Column(name = "brokerage", nullable = false)
    private long brokerage;

    @Column(name = "platform_fee", nullable = false)
    private long platformFee;

    /** Whole rupees, or {@code null} when the duty is computed per agreement — see the class note. */
    @Column(name = "stamp_duty")
    private Long stampDuty;

    /** Whole rupees, or {@code null} when the fee depends on the registering body. */
    @Column(name = "registration")
    private Long registration;

    @Column(name = "gst", nullable = false)
    private long gst;

    /** Free text qualifying the figures — e.g. that stamp duty is indicative and state-specific. */
    @Column(name = "notes")
    private String notes;

    protected PlatformFee() {
        // JPA
    }

}
