package com.draazy.api.common.error;

import org.springframework.http.HttpStatus;

/**
 * 413 — the uploaded file is larger than the platform accepts.
 *
 * <p>Separate from {@link BadRequestException} because the caller's remedy is different in kind:
 * nothing about the request is malformed, the file is simply too big, and the client's job is to
 * ask the user for a smaller scan rather than to fix a field. The contract lists {@code 413} on
 * {@code uploadDocument} for exactly that reason.
 */
public class PayloadTooLargeException extends ApiException {

    public PayloadTooLargeException(String message) {
        super(ErrorCodes.PAYLOAD_TOO_LARGE, HttpStatus.PAYLOAD_TOO_LARGE.value(), message);
    }
}
