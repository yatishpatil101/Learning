package com.punenest.api.catalog.fee;

/**
 * The contract's {@code Fees} record — what one deal costs, published openly (spec fix S24: the
 * endpoint returns one of these per deal intent, not a single object).
 *
 * <p>Every figure is whole rupees ({@code Money} is {@code int64} in the contract), never a float.
 *
 * @param deal         the deal intent this breakdown applies to: {@code buy} or {@code rent}
 * @param brokerage    PuneNest's brokerage — {@code 0}, and the product's whole point
 * @param platformFee  what the platform actually charges
 * @param stampDuty    indicative and state-specific; {@code null} when the duty is not a flat
 *                     figure and is computed per agreement instead (D163) — see {@code notes}
 * @param registration indicative government registration cost; {@code null} when it depends on the
 *                     registering body and is computed per agreement (D163)
 * @param gst          statutory tax on the platform fee
 * @param notes        the qualifications a bare number cannot carry
 */
public record FeeResponse(
        String deal,
        Long brokerage,
        Long platformFee,
        Long stampDuty,
        Long registration,
        Long gst,
        String notes) {
}
