package com.draazy.api.common.error;

/**
 * 409 — the Aadhaar identity behind this verification is already linked to another account
 * (one Aadhaar = one badge, ADR-009b; enforced physically by the {@code identity_hash} UNIQUE index).
 *
 * <p>Deliberately not a plain {@link ConflictException}, which fixes {@link ErrorCodes#CONFLICT}: the
 * React client branches on {@code aadhaar_already_registered} to explain the collision rather than
 * showing a generic retry.
 *
 * <p>Fires only inside the opt-in KYC flow. It never blocks posting, browsing or contact.
 */
public class AadhaarAlreadyRegisteredException extends ApiException {

    public AadhaarAlreadyRegisteredException(String message) {
        super(ErrorCodes.AADHAAR_ALREADY_REGISTERED, 409, message);
    }
}
