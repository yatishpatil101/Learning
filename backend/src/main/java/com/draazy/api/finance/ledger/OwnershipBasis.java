package com.draazy.api.finance.ledger;

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

/** Does not extend {@code BaseEntity}: V6 makes {@code property_id} the primary key, as the basis is 1:1 with the listing.
 * Every money field is nullable whole rupees, as a zero would assert a figure the owner never gave. */
@Entity
@Table(name = "ownership_basis")
@Getter
public class OwnershipBasis {

    @Id
    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    /** Whoever recorded the basis; if the flat changes hands, the new owner's figures are their own. */
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

    /** Loan rate and tenure are deliberately not stored; see {@link FinanceService}. */
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
