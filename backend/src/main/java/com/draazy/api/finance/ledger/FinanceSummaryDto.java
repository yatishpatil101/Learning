package com.draazy.api.finance.ledger;

/**
 * Income, expense and net over a requested window (contract {@code FinanceSummary}).
 *
 * <p><strong>{@code occupancyRate} is nullable, and that is the point</strong> (spec fix S20). It
 * is tenanted-days over days-in-window, so for a listing that has never been let — a sale listing,
 * or a flat the owner lives in — there is no rate to state. Returning {@code 0.0} there would
 * assert "vacant the whole time", which reads as a failing property rather than an inapplicable
 * question.
 *
 * <p>The mock also returned a {@code count}. It has no consumer in the UI and is one
 * {@code .length} away from data the client already holds, so it is not carried here — the same
 * ruling as slice 3's {@code pendingContactCount}.
 *
 * @param income        total received in the window, whole INR
 * @param expense       total spent in the window, whole INR
 * @param net           {@code income - expense}; may be negative
 * @param occupancyRate 0.0–1.0, or null if the property has never had a tenancy
 */
public record FinanceSummaryDto(
        Long income,
        Long expense,
        Long net,
        Double occupancyRate) {
}
