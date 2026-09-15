package com.draazy.api.common.error;

/**
 * 409 — one document = one badge (ADR-009b); distinct code from {@link ConflictException} so the
 * client can render a specific collision message rather than a generic retry.
 */
public class IdentityAlreadyRegisteredException extends ApiException {

    public IdentityAlreadyRegisteredException(String message) {
        super(ErrorCodes.IDENTITY_ALREADY_REGISTERED, 409, message);
    }
}
