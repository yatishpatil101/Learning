package com.punenest.api.common.error;

/** 403 — authenticated but not permitted (RBAC deny, or an owner accepts verified contacts only). */
public class ForbiddenException extends ApiException {
    public ForbiddenException(String message) {
        super(ErrorCodes.FORBIDDEN, 403, message);
    }
}
