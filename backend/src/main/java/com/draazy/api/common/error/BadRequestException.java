package com.draazy.api.common.error;

public class BadRequestException extends ApiException {
    public BadRequestException(String message) {
        super(ErrorCodes.BAD_REQUEST, 400, message);
    }

    public BadRequestException(String code, String message) {
        super(code, 400, message);
    }
}
