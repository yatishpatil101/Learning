package com.punenest.api.finance.rent;

import java.util.Set;

/**
 * The lifecycle vocabulary of a rent payment, and the transitions the webhook is allowed to make.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1. Every value
 * is traced to:
 * <ul>
 *   <li>V6: {@code CHECK (status IN ('due','paid','overdue','failed'))}</li>
 *   <li>OpenAPI: {@code RentPayment.status} enum</li>
 * </ul>
 *
 * <p><strong>{@link #DUE} is the state a freshly-initiated payment is in, and that is deliberate.</strong>
 * The contract says it plainly: the {@code 201} records the payment as pending, and its terminal
 * state is confirmed asynchronously by Cashfree. A gateway order having been <em>created</em> says
 * nothing about whether money moved — the tenant may never open the checkout, may abandon it, or may
 * have the transaction declined by their bank. Marking a row {@code paid} on the strength of a
 * {@code 201} is how a platform ends up telling an owner they were paid when they were not.
 *
 * <p><strong>{@link #OVERDUE} is derived, not transitioned into.</strong> It is what {@link #DUE}
 * becomes once its due date has passed; nothing writes it in response to an event. It is listed here
 * because the column permits it and a reader needs to know why nothing sets it.
 */
public final class RentPaymentStatuses {

    private RentPaymentStatuses() {
    }

    /** Initiated and awaiting the provider's terminal callback. The state every payment starts in. */
    public static final String DUE = "due";

    /** Settled. Only the payment webhook may write this. */
    public static final String PAID = "paid";

    /** Past its due date and still unpaid. Derived from {@link #DUE} plus the calendar. */
    public static final String OVERDUE = "overdue";

    /** The provider reported a terminal failure. The tenant may retry, which creates a new row. */
    public static final String FAILED = "failed";

    private static final Set<String> ALL = Set.of(DUE, PAID, OVERDUE, FAILED);

    /** Whether {@code value} is a status the column and the contract both accept. */
    public static boolean isValid(String value) {
        return value != null && ALL.contains(value);
    }

    /**
     * Whether a payment in {@code current} may move to {@code next}.
     *
     * <p>Only {@link #DUE} and {@link #OVERDUE} are open. Once a payment is {@link #PAID} or
     * {@link #FAILED} it is terminal, and a later callback for the same order must be ignored rather
     * than applied — Cashfree may redeliver an event, and a replayed {@code FAILED} landing on a row
     * that has already settled would tell an owner their rent bounced after they had been credited.
     */
    public static boolean canTransition(String current, String next) {
        if (!isValid(current) || !isValid(next)) {
            return false;
        }
        boolean open = DUE.equals(current) || OVERDUE.equals(current);
        return open && (PAID.equals(next) || FAILED.equals(next));
    }
}
