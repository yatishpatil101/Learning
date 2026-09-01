package com.punenest.api.catalog.managed;

import com.punenest.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * One month of rent an owner recorded as received outside PuneNest's payment rail (V120).
 *
 * <p>Deliberately not a {@code RentPayment}: that row is the <em>tenant's</em> gateway payment and
 * its paid state is set by a webhook. This one is the owner's own assertion that cash or a bank
 * transfer we never saw arrived, which is why nothing in the Owner Hub may touch the gateway's
 * state and nothing here reads it.
 *
 * <p>Every field except {@code rentMonth} is a snapshot taken from the owned {@link ManagedProperty}
 * at the moment of recording, never accepted from a request body — a receipt handed to a tenant in
 * August must keep saying what it said in August after the owner raises the rent or edits the
 * address. That is enforced structurally: there are no setters, every column is
 * {@code updatable = false}, and the only way to build one is the constructor below.
 *
 * <p>{@code createdAt} (from {@link AuditedEntity}) is the receipt date. The endpoint takes no date,
 * so a separate {@code receivedAt} could only ever be a copy of it.
 */
@Entity
@Table(name = "managed_property_rent_receipts")
@Getter
public class ManagedRentReceipt extends AuditedEntity {

    /** Matches the DB CHECK; validated here too so a bad month is a 422, not a constraint violation. */
    static final String MONTH_PATTERN = "^[0-9]{4}-(0[1-9]|1[0-2])$";

    @Column(name = "managed_property_id", nullable = false, updatable = false)
    private UUID managedPropertyId;

    @Column(name = "rent_month", nullable = false, updatable = false, length = 7)
    private String rentMonth;

    @Column(name = "amount", nullable = false, updatable = false)
    private long amount;

    @Column(name = "tenant_name", nullable = false, updatable = false, length = 200)
    private String tenantName;

    @Column(name = "landlord_name", nullable = false, updatable = false, length = 200)
    private String landlordName;

    @Column(name = "property_address", nullable = false, updatable = false, length = 500)
    private String propertyAddress;

    protected ManagedRentReceipt() {
        // JPA
    }

    /**
     * Snapshot the owned property into an immutable receipt. The caller is responsible for having
     * established that the property is the caller's, is rented, and carries a positive rent and a
     * tenant name — see {@code ManagedPropertyService.recordRentReceipt}, which is the only caller
     * and answers 422 rather than reaching here with a property that cannot produce a receipt.
     *
     * @param property     the owner's managed record, already ownership-checked
     * @param rentMonth    {@code YYYY-MM}, already normalised and format-checked
     * @param landlordName the owner's name, resolved server-side from the token's user
     */
    ManagedRentReceipt(ManagedProperty property, String rentMonth, String landlordName) {
        this.managedPropertyId = property.getId();
        this.rentMonth = rentMonth;
        this.amount = property.getMonthlyRent();
        this.tenantName = fit(property.getTenantName(), 200);
        this.landlordName = fit(landlordName, 200);
        this.propertyAddress = fit(addressOf(property), 500);
    }

    /**
     * Trim a snapshotted value to what its column holds. Both sources are {@code text} upstream -
     * {@code managed_properties.tenant_name} and {@code users.name} - so a name longer than the
     * receipt's {@code varchar(200)} is reachable without doing anything unusual, and it would
     * arrive as a constraint violation at flush: an unactionable 500 on a receipt the owner is
     * entitled to, permanently, until they rename their own tenant. Truncating is the right answer
     * rather than rejecting, because the name is not what the owner is being asked for here.
     */
    private static String fit(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() > max ? value.substring(0, max) : value;
    }

    /**
     * The address line a receipt carries. Composed here rather than stored on the property because
     * the property has no address column — an owner captures a society and a locality, and the
     * Owner Hub card has always rendered "society, locality, Pune" from them. The receipt keeps the
     * rendered line, not the parts, because that is what was on the paper.
     */
    private static String addressOf(ManagedProperty property) {
        StringBuilder out = new StringBuilder();
        for (String part : new String[] { property.getSociety(), property.getLocality(), "Pune" }) {
            if (part != null && !part.isBlank()) {
                out.append(out.isEmpty() ? "" : ", ").append(part.trim());
            }
        }
        return out.toString();
    }
}
