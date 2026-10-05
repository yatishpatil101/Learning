package com.draazy.api.common.error;

public class ConflictException extends ApiException {
    public ConflictException(String message) {
        super(ErrorCodes.CONFLICT, 409, message);
    }

    public ConflictException(String code, String message) {
        super(code, 409, message);
    }
}
