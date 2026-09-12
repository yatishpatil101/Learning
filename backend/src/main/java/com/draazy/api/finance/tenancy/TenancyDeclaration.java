package com.draazy.api.finance.tenancy;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

/**
 * Somebody's claim that they lived in a listing, and the owner's answer to it (V68
 * {@code tenancy_declarations}).
 *
 * <p><strong>Why this is not a {@link Tenancy}.</strong> A tenancy is created by the system when a
 * rent deal closes and is the parent of every rent payment; V12 permits one active row per property.
 * A declaration is a claim typed by a person about a stay that has usually already ended, several of
 * which may legitimately exist for the same flat. Writing one into the other would both violate that
 * index and make a typed claim indistinguishable from a signed agreement at every later read — see
 * the migration for the full argument.
 *
 * <p><strong>Only the owner's confirmation makes it evidence.</strong> A {@code pending} row proves
 * nothing; it is a person asserting something about somebody else's property. What turns it into
 * evidence is the counterparty agreeing, which is why {@link #ownerId} is checked on the confirm
 * path rather than merely requiring a signed-in — or even an identity-verified — caller. "Someone
 * verified said yes" is not the same fact as "the owner said yes".
 *
 * <p>{@link #ownerId} is copied at declaration time rather than resolved through the listing on each
 * check, so a later change of owner cannot hand the power to confirm a stay to somebody who was not
 * the landlord when it happened.
 *
 * <p>Ids, not associations: this entity lives in {@code finance} while the property and both users
 * live in {@code catalog} and {@code identity}, exactly as {@link Tenancy} does.
 */
@Entity
@Table(name = "tenancy_declarations")
@Getter
public class TenancyDeclaration extends AuditedEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** The person claiming they lived there — the review-eligibility subject. */
    @Column(name = "declarant_id", nullable = false, updatable = false)
    private UUID declarantId;

    /** The listing's owner as at declaration time; the only account that may decide this row. */
    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    /** One of {@link TenancyDeclarationStatuses}; the V68 CHECK rejects anything else. */
    @Column(name = "status", nullable = false)
    private String status = TenancyDeclarationStatuses.PENDING;

    /** Optional, and unverified either way — context for the owner, never used as evidence. */
    @Column(name = "lived_from")
    private LocalDate livedFrom;

    @Column(name = "lived_to")
    private LocalDate livedTo;

    /** When the owner last answered; null while pending. */
    @Column(name = "decided_at")
    private Instant decidedAt;

    protected TenancyDeclaration() {
        // JPA
    }

    TenancyDeclaration(UUID propertyId, UUID declarantId, UUID ownerId, LocalDate livedFrom,
            LocalDate livedTo) {
        this.propertyId = propertyId;
        this.declarantId = declarantId;
        this.ownerId = ownerId;
        this.livedFrom = livedFrom;
        this.livedTo = livedTo;
    }

    /**
     * Record the owner's answer. Both transitions are expressed here rather than by letting callers
     * assign a status, so {@code decided_at} can never drift from the status it is supposed to date.
     *
     * @param status one of {@link TenancyDeclarationStatuses}
     */
    void decide(String status) {
        this.status = status;
        this.decidedAt = Instant.now();
    }
}
