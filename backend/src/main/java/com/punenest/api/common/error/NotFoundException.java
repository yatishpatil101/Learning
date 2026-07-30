package com.punenest.api.common.error;

/** 404 — a requested resource does not exist (or is archived and hidden from the caller). */
public class NotFoundException extends ApiException {
    public NotFoundException(String message) {
        super(ErrorCodes.NOT_FOUND, 404, message);
    }
}
