package com.draazy.api.finance.tenancy;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Tenant screening profile, keyed by {@code user_id}. Maps {@code tenant_profiles}.
 * Rationale: docs/flows/consumer/rent-tenancy.md#tenant-screening-score-badge-batch-reads
 */
@Entity
@Table(name = "tenant_profiles")
@Getter
public class TenantProfile {

    @Id
    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    @Column(name = "name")
    @Setter
    private String name;

    /** Free text, as the tenant typed it — "Software Engineer", "Doctor", "Own business". */
    @Column(name = "occupation")
    @Setter
    private String occupation;

    /** Monthly income, whole INR. Nullable: supplying it raises the score, nothing requires it. */
    @Column(name = "income")
    @Setter
    private Long income;

    /** One of {@link OccupantTypes}; V10's CHECK rejects anything else. */
    @Column(name = "occupants")
    @Setter
    private String occupants;

    @Column(name = "move_in")
    @Setter
    private LocalDate moveIn;

    /** A reference contact, free text — never parsed, never dialled by the platform. */
    @Column(name = "prior_landlord")
    @Setter
    private String priorLandlord;

    @Column(name = "about")
    @Setter
    private String about;

    /** Computed by {@link TenantProfileService#score}; 0–100, never client-supplied. */
    @Column(name = "score")
    @Setter
    private Integer score;

    /** Mirrors the identity badge. Written by the verification feature, read-only here. */
    @Column(name = "verified", nullable = false)
    @Setter
    private boolean verified;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected TenantProfile() {
        // JPA
    }

    public TenantProfile(UUID userId) {
        this.userId = userId;
    }

}
