package com.draazy.api.common.error;

/**
 * 403 — verified-users-only listing, caller has no L2 badge. Distinct code from
 * {@link ForbiddenException} so the client can surface the verify-identity prompt (ADR-019).
 */
public class VerificationRequiredException extends ApiException {

    public VerificationRequiredException(String message) {
        super(ErrorCodes.VERIFICATION_REQUIRED, 403, message);
    }
}
