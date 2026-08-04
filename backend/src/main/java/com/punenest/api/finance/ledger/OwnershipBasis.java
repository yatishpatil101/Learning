package com.punenest.api.finance.ledger;

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
 * What a property cost its owner and what it is worth now — the denominator the ledger's returns
 * are measured against. Maps {@code ownership_basis} (V6).
 *
 * <p><strong>The one entity that does not extend {@code BaseEntity}</strong>, and deliberately so.
 * V6 makes {@code property_id} the primary key: the basis is 1:1 with the listing, not a thing with
 * a life of its own. A surrogate {@code id} would permit two basis rows for one property — exactly
 * the ambiguity the natural key rules out — and the contract agrees, exposing it as a singular
 * {@code GET/PUT /me/finances/{propId}/basis} with no id anywhere in the shape. Inheriting the base
 * class to save a few lines would mean mapping a column the table does not have.
 *
 * <p>Every money field is {@code Long} whole rupees, and every one is nullable: an owner may know
 * their purchase price but not their current valuation, and a zero would assert a figure they never
 * gave.
 */
@Entity
@Table(name = "ownership_basis")
@Getter
public class OwnershipBasis {

    @Id
    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /**
     * Whoever recorded the basis. Not merely a copy of the listing's owner: if the flat changes
     * hands, the new owner's purchase price is their own, and this row records whose figures these
     * were.
     */
    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    @Column(name = "purchase_price")
    @Setter
    private Long purchasePrice;

    @Column(name = "purchase_date")
    @Setter
    private LocalDate purchaseDate;

    @Column(name = "loan_outstanding")
    @Setter
    private Long loanOutstanding;

    /**
     * The monthly instalment. The loan's interest rate and tenure are deliberately not stored — see
     * {@link FinanceService} for the reasoning.
     */
    @Column(name = "emi")
    @Setter
    private Long emi;

    @Column(name = "current_value")
    @Setter
    private Long currentValue;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected OwnershipBasis() {
        // JPA
    }

    public OwnershipBasis(UUID propertyId, UUID ownerId) {
        this.propertyId = propertyId;
        this.ownerId = ownerId;
    }

}
