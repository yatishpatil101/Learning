package com.punenest.api.common.error;

/** 401 — no/invalid credentials. Thrown from controllers/services; the security entry point
 * handles the filter-chain case. */
public class UnauthorizedException extends ApiException {
    public UnauthorizedException(String message) {
        super(ErrorCodes.UNAUTHORIZED, 401, message);
    }
}
