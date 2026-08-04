package com.punenest.api.finance.rent;

import java.util.Set;

/**
 * How a rent payment was made.
 *
 * <p>{@code String} constants, not an {@code enum}, per {@code api-standards.md} §7.1, traced to
 * V6's {@code CHECK (method IN ('upi','netbanking','card','autopay','cash'))} and the contract's
 * {@code RentPayment.method} enum.
 */
public final class PaymentMethods {

    private PaymentMethods() {
    }

    /** UPI collect / intent — the default in India and the method most tenants will use. */
    public static final String UPI = "upi";

    public static final String NETBANKING = "netbanking";

    public static final String CARD = "card";

    /** Charged by a standing mandate; see {@link MandateStatuses}. */
    public static final String AUTOPAY = "autopay";

    /**
     * Recorded off-platform. Accepted by V6's CHECK and returned by reads, but <strong>not</strong>
     * offered on {@code RentPaymentCreate} — the platform cannot initiate a cash payment, it can
     * only be told one happened. Kept here so reading a manually-entered row does not fail
     * validation.
     */
    public static final String CASH = "cash";

    private static final Set<String> ALL = Set.of(UPI, NETBANKING, CARD, AUTOPAY, CASH);

    /** Methods a client may ask us to charge with. Excludes {@link #CASH}; see above. */
    private static final Set<String> PAYABLE = Set.of(UPI, NETBANKING, CARD, AUTOPAY);

    /** Whether {@code value} is a method the column accepts. */
    public static boolean isValid(String value) {
        return value != null && ALL.contains(value);
    }

    /** Whether {@code value} is a method a client may initiate a payment with. */
    public static boolean isPayable(String value) {
        return value != null && PAYABLE.contains(value);
    }

    /** The payable methods, for a 422 that tells the caller what to send instead. */
    public static String payableList() {
        return String.join(", ", PAYABLE.stream().sorted().toList());
    }
}
