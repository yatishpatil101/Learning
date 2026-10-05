package com.draazy.api.identity.verification;

import java.util.Set;

// Mirrors the CHECK on identity_verifications.doc_type.
public final class IdentityDocTypes {

    private IdentityDocTypes() {
    }

    public static final String AADHAAR = "aadhaar";
    public static final String PAN = "pan";
    public static final String DRIVING_LICENCE = "driving_licence";
    public static final String PASSPORT = "passport";
    public static final String VOTER_ID = "voter_id";

    public static final Set<String> ALL = Set.of(AADHAAR, PAN, DRIVING_LICENCE, PASSPORT, VOTER_ID);

    public static boolean requiresBack(String docType) {
        return AADHAAR.equals(docType) || VOTER_ID.equals(docType);
    }
}
