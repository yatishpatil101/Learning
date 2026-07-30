package com.punenest.api.common.error;

/** 409 — the request conflicts with current state (e.g. unit already claimed, code already redeemed). */
public class ConflictException extends ApiException {
    public ConflictException(String message) {
        super(ErrorCodes.CONFLICT, 409, message);
    }
}
