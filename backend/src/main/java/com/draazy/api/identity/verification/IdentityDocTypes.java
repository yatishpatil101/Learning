package com.draazy.api.identity.verification;

import java.util.Set;

/**
 * Three accepted identity documents, mirroring the V23 CHECK on {@code identity_verifications.doc_type}.
 * Only Aadhaar requires a back capture; PAN and DL are single-sided.
 */
public final class IdentityDocTypes {

    private IdentityDocTypes() {
    }

    public static final String AADHAAR = "aadhaar";
    public static final String PAN = "pan";
    public static final String DRIVING_LICENCE = "driving_licence";

    public static final Set<String> ALL = Set.of(AADHAAR, PAN, DRIVING_LICENCE);

    public static boolean requiresBack(String docType) {
        return AADHAAR.equals(docType);
    }
}
