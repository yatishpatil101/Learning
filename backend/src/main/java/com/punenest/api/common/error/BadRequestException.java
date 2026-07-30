package com.punenest.api.common.error;

/** 400 — a malformed request the caller can fix (bad param, unreadable body). */
public class BadRequestException extends ApiException {
    public BadRequestException(String message) {
        super(ErrorCodes.BAD_REQUEST, 400, message);
    }
}
