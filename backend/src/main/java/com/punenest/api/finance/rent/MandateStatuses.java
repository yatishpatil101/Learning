package com.punenest.api.finance.rent;

import java.util.Set;

/**
 * The autopay mandate lifecycle.
 *
 * <p>{@code String} constants per {@code api-standards.md} §7.1, traced to V6's
 * {@code CHECK (status IN ('active','paused','revoked'))} and the contract's
 * {@code RentMandate.status} enum.
 *
 * <p><strong>{@link #REVOKED} is terminal; {@link #PAUSED} is not.</strong> A mandate is a standing
 * instruction against someone's bank account. Pausing is a temporary hold the tenant can lift;
 * revoking is the withdrawal of consent. Letting a revoked mandate be reactivated would mean a
 * tenant who cancelled autopay could find it charging again without ever having given permission a
 * second time — so a revoked mandate is a dead record, and a new one must be set up from scratch.
 */
public final class MandateStatuses {

    private MandateStatuses() {
    }

    /** Live; will be charged on its day of the month. */
    public static final String ACTIVE = "active";

    /** Temporarily held by the tenant. Reversible. */
    public static final String PAUSED = "paused";

    /** Consent withdrawn. Terminal — a new mandate must be created instead. */
    public static final String REVOKED = "revoked";

    private static final Set<String> ALL = Set.of(ACTIVE, PAUSED, REVOKED);

    /** Whether {@code value} is a status the column and the contract both accept. */
    public static boolean isValid(String value) {
        return value != null && ALL.contains(value);
    }

    /** Whether a mandate in {@code current} may move to {@code next}. */
    public static boolean canTransition(String current, String next) {
        if (!isValid(current) || !isValid(next) || REVOKED.equals(current)) {
            return false;
        }
        return !current.equals(next);
    }

    /** The statuses a client may set, for a 422 message. */
    public static String settableList() {
        return String.join(", ", ALL.stream().sorted().toList());
    }
}
