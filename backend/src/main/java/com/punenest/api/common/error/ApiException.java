package com.punenest.api.common.error;

/**
 * Base of the typed exception hierarchy. Each subclass fixes a machine-readable {@code code} and an
 * HTTP {@code status}; the {@link com.punenest.api.common.error.GlobalExceptionHandler} turns any
 * {@code ApiException} into the contract error envelope with no per-controller boilerplate.
 */
public abstract class ApiException extends RuntimeException {

    private final String code;
    private final int status;

    protected ApiException(String code, int status, String message) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String getCode() {
        return code;
    }

    public int getStatus() {
        return status;
    }
}
