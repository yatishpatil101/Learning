package com.draazy.api.common.error;

/** 401 — no/invalid credentials. Thrown from controllers/services; the security entry point
 * handles the filter-chain case. */
public class UnauthorizedException extends ApiException {
    public UnauthorizedException(String message) {
        this(ErrorCodes.UNAUTHORIZED, message);
    }

    /**
     * A 401 a client must handle differently from "those credentials were wrong" — see
     * {@link ErrorCodes#ACCOUNT_ARCHIVED}. Subclasses carrying extra detail keep the generic code.
     */
    public UnauthorizedException(String code, String message) {
        super(code, 401, message);
    }
}
