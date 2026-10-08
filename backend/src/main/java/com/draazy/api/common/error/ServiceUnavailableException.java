package com.draazy.api.common.error;

/** 503 — a provider we depend on could not answer, so the caller's input is not at fault. */
public class ServiceUnavailableException extends ApiException {

    public ServiceUnavailableException(String message) {
        super(ErrorCodes.SERVICE_UNAVAILABLE, 503, message);
    }
}
