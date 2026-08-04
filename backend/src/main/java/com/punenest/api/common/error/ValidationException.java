package com.punenest.api.common.error;

/**
 * 422 — a request field failed a rule that Bean Validation could not express.
 *
 * <p><strong>Why this exists alongside {@link BadRequestException}.</strong> The contract's answer to
 * a malformed request body is {@code 422 ValidationProblem}, and annotation-driven validation already
 * produces exactly that. But some rules are <em>conditional</em> — a flat split's room count depends
 * on the parent listing's {@code bhk}, and its occupancy cap depends on the room count — so they can
 * only be checked once the referenced row has been read. Throwing {@link BadRequestException} for
 * those emits a 400, which the operations in question do not declare: a client written against the
 * contract would not handle it.
 *
 * <p>Use this when the caller sent a value that is wrong <em>for this request</em>. Keep
 * {@link BadRequestException} for a request that is malformed in itself.
 */
public class ValidationException extends ApiException {

    public ValidationException(String message) {
        super(ErrorCodes.VALIDATION_FAILED, 422, message);
    }
}
