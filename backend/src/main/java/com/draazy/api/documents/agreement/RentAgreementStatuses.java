package com.draazy.api.documents.agreement;

/**
 * The {@code RentAgreement.status} ladder, mirroring the V6 CHECK.
 *
 * <p>Only {@link #DRAFT} is reachable from this slice. The transitions out of it are ops actions
 * driven by the service workflow ({@code /service-requests}), so putting a transition table here
 * now would be a guess at rules that live in a slice not yet written.
 */
public final class RentAgreementStatuses {

    private RentAgreementStatuses() {
    }

    public static final String DRAFT = "draft";
    public static final String E_SIGN_PENDING = "e-sign-pending";
    public static final String REGISTERED = "registered";
    public static final String ACTIVE = "active";
    public static final String EXPIRED = "expired";
}
