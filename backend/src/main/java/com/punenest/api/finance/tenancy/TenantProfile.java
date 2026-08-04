package com.punenest.api.finance.tenancy;

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
 * A tenant's screening profile — what an owner reads before deciding whether to let their flat to
 * this person. Maps {@code tenant_profiles} (V6, reshaped by V13 for spec fix S21).
 *
 * <p><strong>Keyed by {@code user_id}, like {@link com.punenest.api.finance.ledger.OwnershipBasis}
 * is keyed by property.</strong> A user has exactly one tenant profile or none; a surrogate id
 * would permit two, and "which of your two profiles did the owner see" is not a question this
 * product should be able to ask.
 *
 * <p><strong>{@code score} and {@code verified} are server-owned</strong> (spec fix S17). They are
 * the entire reason an owner trusts the profile, so a tenant who could set them would be grading
 * their own paper. {@code score} is recomputed on every save by
 * {@link TenantProfileService#score}; {@code verified} mirrors the Aadhaar badge from
 * {@code identity.verification} and is never written from this feature at all.
 *
 * <p>{@code income} is {@code Long} whole rupees per month, matching the contract's {@code Money}
 * and the schema's bigint money convention.
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

    /** One of {@link OccupantTypes}; V13's CHECK rejects anything else. */
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

    /** Mirrors the Aadhaar badge. Written by the verification feature, read-only here. */
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
