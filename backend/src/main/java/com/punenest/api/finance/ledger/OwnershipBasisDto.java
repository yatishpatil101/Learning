package com.punenest.api.finance.ledger;

import java.time.LocalDate;

/**
 * The ownership basis as the wire sees it (contract {@code OwnershipBasis}), and also the body of
 * {@code PUT /me/finances/{propId}/basis} — the contract uses one schema for both directions.
 *
 * <p>That is safe here because nothing in this shape
 * is masked or server-derived: every field is a figure the owner typed and is entitled to read back
 * exactly as they entered it. A read/write split would be two identical records.
 *
 * <p>All fields nullable — an owner may know their purchase price but not their current valuation.
 *
 * @param purchasePrice   whole INR
 * @param loanOutstanding whole INR still owed
 * @param emi             the monthly instalment, whole INR
 * @param currentValue    the owner's estimate of today's value, whole INR
 */
public record OwnershipBasisDto(
        Long purchasePrice,
        LocalDate purchaseDate,
        Long loanOutstanding,
        Long emi,
        Long currentValue) {
}
