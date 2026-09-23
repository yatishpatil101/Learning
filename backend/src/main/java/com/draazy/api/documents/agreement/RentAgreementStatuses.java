package com.draazy.api.documents.agreement;

import java.util.List;
import java.util.Map;

/** The {@code RentAgreement.status} ladder, mirroring the V6 CHECK. A table rather than free text
 * because {@link RentAgreementRepository#hasRegisteredTenancy} reads these as proof for a badge. */
public final class RentAgreementStatuses {

    private RentAgreementStatuses() {
    }

    public static final String DRAFT = "draft";
    public static final String E_SIGN_PENDING = "e-sign-pending";
    public static final String REGISTERED = "registered";
    public static final String ACTIVE = "active";
    public static final String EXPIRED = "expired";

    /** {@link #DRAFT} reaches {@link #REGISTERED} directly because most Maharashtra registration is
     * in person. Nothing walks backwards, and nothing leaves {@link #EXPIRED}. */
    private static final Map<String, List<String>> NEXT = Map.of(
            DRAFT, List.of(E_SIGN_PENDING, REGISTERED, EXPIRED),
            E_SIGN_PENDING, List.of(REGISTERED, EXPIRED),
            REGISTERED, List.of(ACTIVE, EXPIRED),
            ACTIVE, List.of(EXPIRED),
            EXPIRED, List.of());

    /** Every status the V6 CHECK accepts, in ladder order. */
    public static final List<String> ALL =
            List.of(DRAFT, E_SIGN_PENDING, REGISTERED, ACTIVE, EXPIRED);

    /** Is {@code status} one of the five the column allows? */
    public static boolean isKnown(String status) {
        return NEXT.containsKey(status);
    }

    /** Standing still answers {@code false}: a silent no-op would let ops file the same registration
     * twice and be told it worked both times. */
    public static boolean canMove(String from, String to) {
        return NEXT.getOrDefault(from, List.of()).contains(to);
    }

    /** The legal next steps from {@code from}, in ladder order, so a refusal can name them. */
    public static List<String> nextFrom(String from) {
        return NEXT.getOrDefault(from, List.of());
    }
}
