package com.punenest.api.finance.tenancy;

import jakarta.validation.constraints.AssertTrue;
import java.time.LocalDate;

/**
 * The body of {@code POST /properties/{propId}/tenancy-declarations} (contract
 * {@code TenancyDeclarationCreate}).
 *
 * <p>Both fields are optional and neither is trusted. The claimant is telling the owner roughly when
 * they lived there so the owner has something to recognise; the platform makes no use of the dates
 * and does not check them against anything, because there is nothing to check them against. The one
 * rule V68 does enforce is that a stay cannot end before it began — a typo the owner would be
 * unlikely to catch while skimming a list of names.
 *
 * <p>Notably absent: who the owner is. That is read from the listing, never from the request. Taking
 * it from the body would let a claimant nominate their own confirmer, which is the same hole as
 * having no confirmation step at all.
 *
 * @param livedFrom claimed start of the stay, or null
 * @param livedTo   claimed end of the stay, or null
 */
public record TenancyDeclarationCreateRequest(LocalDate livedFrom, LocalDate livedTo) {

    /**
     * The same rule V68's {@code CHECK} holds, stated here as well so a reversed pair answers 422
     * with a {@code fields[]} entry rather than 409 "that request conflicts with existing data" —
     * which is what a bare integrity violation would look like from outside, and which tells the
     * person who mistyped a date nothing about the dates. The constraint stays in the database
     * because that is what makes it true of every row, including any written by a future path that
     * never sees this record.
     */
    @AssertTrue(message = "livedTo cannot be before livedFrom")
    public boolean isDateRangeOrdered() {
        return livedFrom == null || livedTo == null || !livedTo.isBefore(livedFrom);
    }
}
