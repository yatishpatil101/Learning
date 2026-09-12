package com.draazy.api.common.error;

/** 403 — authenticated but not permitted (RBAC deny, or an owner accepts verified contacts only). */
public class ForbiddenException extends ApiException {
    public ForbiddenException(String message) {
        this(ErrorCodes.FORBIDDEN, message);
    }

    /**
     * A 403 a client must handle differently from a permission deny — see
     * {@link ErrorCodes#SIGNUPS_CLOSED}, which signing in again cannot fix.
     */
    public ForbiddenException(String code, String message) {
        super(code, 403, message);
    }
}
