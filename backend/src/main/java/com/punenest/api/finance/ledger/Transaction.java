package com.punenest.api.finance.ledger;

import com.punenest.api.common.persistence.SoftDeleteEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import lombok.Setter;

/**
 * One row of an owner's property finance ledger. Maps {@code transactions} (V6, soft-delete added
 * by V12).
 *
 * <p><strong>Soft-delete, and it matters more here than elsewhere.</strong> These rows are what
 * {@code /summary}, {@code /cashflow} and {@code /dues} are computed from, and an owner reconciles
 * those totals against a bank statement and a tax return. A hard delete would change last month's
 * net with nothing left to explain why. {@link SoftDeleteEntity} keeps the row available to answer
 * that question.
 *
 * <p><strong>Money is {@code Long}.</strong> {@code amount} is {@code bigint} (V6) holding whole
 * rupees, matching the contract's {@code Money} ({@code int64}). Never {@code double} — a ledger
 * that sums floating-point rupees does not add up to what the bank says, and the error grows with
 * the number of rows. Amounts are stored <strong>unsigned</strong>; {@link TransactionTypes}
 * carries the direction.
 *
 * <p><strong>Ids, not associations.</strong> {@code propertyId} and {@code ownerId} are plain UUID
 * columns. This entity lives in {@code finance} while its targets live in {@code catalog} and
 * {@code identity}; an object reference would hard-wire a cross-context join and drag those
 * aggregates into every ledger read.
 *
 * <p><strong>Why {@code ownerId} is stored at all</strong>, when it is derivable from the property:
 * it is the ledger's <em>author</em>, not a copy of the listing's owner. If a listing changes hands
 * the new owner must not inherit the previous owner's private expense history, so the row keeps the
 * identity of whoever recorded it.
 */
@Entity
@Table(name = "transactions")
@Getter
public class Transaction extends SoftDeleteEntity {

    @Column(name = "property_id", nullable = false, updatable = false)
    private UUID propertyId;

    @Column(name = "owner_id", nullable = false, updatable = false)
    private UUID ownerId;

    /** One of {@link TransactionTypes}; the V6 CHECK rejects anything else. */
    @Column(name = "type", nullable = false)
    @Setter
    private String type;

    /**
     * Free text, owner-chosen. Deliberately not a validated vocabulary — see
     * {@link FinanceService} for the reasoning.
     */
    @Column(name = "category")
    @Setter
    private String category;

    /** Whole INR, unsigned. */
    @Column(name = "amount", nullable = false)
    @Setter
    private Long amount;

    /** The date the money moved, not the date the row was created. */
    @Column(name = "date", nullable = false)
    @Setter
    private LocalDate date;

    @Column(name = "note")
    @Setter
    private String note;

    /** One of {@link RecurringIntervals}; the V6 CHECK rejects anything else. */
    @Column(name = "recurring", nullable = false)
    @Setter
    private String recurring = RecurringIntervals.NONE;

    protected Transaction() {
        // JPA
    }

    public Transaction(UUID propertyId, UUID ownerId, String type, Long amount, LocalDate date) {
        this.propertyId = propertyId;
        this.ownerId = ownerId;
        this.type = type;
        this.amount = amount;
        this.date = date;
    }

}
