package com.punenest.api.common.error;

import org.springframework.http.HttpStatus;

/**
 * 415 — the uploaded file is of a type the document vault will not store.
 *
 * <p>The allowlist is a security control, not a convenience: a vault that accepts
 * {@code text/html} or an executable becomes a hosting service for whatever the attacker wants a
 * PuneNest-looking URL to serve. So this is a refusal, and the message names the accepted types
 * rather than the rejected one.
 */
public class UnsupportedMediaTypeException extends ApiException {

    public UnsupportedMediaTypeException(String message) {
        super(ErrorCodes.UNSUPPORTED_MEDIA_TYPE, HttpStatus.UNSUPPORTED_MEDIA_TYPE.value(), message);
    }
}
