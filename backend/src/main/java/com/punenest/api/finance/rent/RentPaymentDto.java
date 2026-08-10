package com.punenest.api.finance.rent;

import java.time.LocalDate;

/**
 * A rent payment as returned to either party (contract {@code RentPayment}).
 *
 * <p>{@code platformFee} and {@code gst} are present because of spec fix S13. V6 always stored them
 * as server-computed values, but they were absent from the response, so the only place a tenant
 * could see the fee was the browser's own calculation — and a fee the client computes is a fee the
 * client can change.
 *
 * @param id            opaque payment id
 * @param tenancyId     the tenancy this settles
 * @param amount        the rent itself, whole rupees, excluding fee and GST
 * @param platformFee   the platform's convenience fee
 * @param gst           GST on {@code platformFee}
 * @param dueDate       the rent month this settles
 * @param paidDate      settlement date; null until the provider confirms
 * @param status        see {@link RentPaymentStatuses} — {@code due} means pending, not overdue
 * @param method        see {@link PaymentMethods}
 * @param reference     the gateway order id, so a tenant can quote it to support
 * @param failureReason why it failed when {@code status} is {@code failed}, else null — usually the
 *                      provider's reason, or ours when the checkout could never be opened
 * @param paymentSessionId the single-use Cashfree session for the checkout SDK, present only in the
 *                      immediate {@code payRent} response for a freshly opened order; never
 *                      persisted, so always null from the ledger read (D167)
 */
public record RentPaymentDto(
        String id,
        String tenancyId,
        Long amount,
        Long platformFee,
        Long gst,
        LocalDate dueDate,
        LocalDate paidDate,
        String status,
        String method,
        String reference,
        String failureReason,
        String paymentSessionId) {

    /** Same payment with the single-use checkout session attached (fresh order only). */
    public RentPaymentDto withPaymentSessionId(String sessionId) {
        return new RentPaymentDto(id, tenancyId, amount, platformFee, gst, dueDate, paidDate,
                status, method, reference, failureReason, sessionId);
    }
}
