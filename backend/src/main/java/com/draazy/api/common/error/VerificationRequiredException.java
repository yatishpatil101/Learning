package com.draazy.api.common.error;

/**
 * 403 — the listing owner accepts contact from verified users only and this caller has no L2 badge.
 *
 * <p>Deliberately <em>not</em> a {@link ForbiddenException}: that class fixes
 * {@link ErrorCodes#FORBIDDEN}, and the client must be able to tell this case apart from an ordinary
 * RBAC deny — {@code verification_required} is the one code that should surface the Aadhaar prompt.
 *
 * <p><strong>Invariant (ADR-019, badge-not-gate):</strong> this is the <em>only</em> place in the
 * contact path that may 403 on a missing badge. Raising it anywhere else would turn an opt-in trust
 * signal into a wall.
 */
public class VerificationRequiredException extends ApiException {

    public VerificationRequiredException(String message) {
        super(ErrorCodes.VERIFICATION_REQUIRED, 403, message);
    }
}
