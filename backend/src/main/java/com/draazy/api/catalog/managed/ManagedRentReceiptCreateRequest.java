package com.draazy.api.catalog.managed;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Write shape for recording a month as received.
 *
 * <p><strong>One field, and that is the contract, not an oversight.</strong> The amount, the tenant,
 * the landlord and the address are all read from the owned property server-side. Accepting any of
 * them here would let a caller issue themselves a receipt for a rent that was never agreed and a
 * tenant who does not exist — and a rent receipt is a tax document, so "the client sent it" is not a
 * provenance anybody should accept for one.
 *
 * <p>The pattern is the same one the column's CHECK enforces (V120), shared with the entity as a
 * compile-time constant so the two cannot drift. Having it here as well is what turns a malformed
 * month into a 422 naming the field, rather than a constraint violation surfacing as a 500 from a
 * code path nobody wrote.
 *
 * @param rentMonth the month being recorded, {@code YYYY-MM}
 */
public record ManagedRentReceiptCreateRequest(
        @NotBlank
        @Pattern(regexp = ManagedRentReceipt.MONTH_PATTERN, message = "rentMonth must be YYYY-MM")
        String rentMonth) {
}
