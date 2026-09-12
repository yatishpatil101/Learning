package com.draazy.api.common.error;

/**
 * 412 — a conditional request whose precondition no longer holds.
 *
 * <p>Distinct from {@link ConflictException} on purpose, even though both mean "you are not looking
 * at the current state". A 409 says the request conflicts with reality and would still conflict if
 * you sent it again; a 412 says <em>you asked to be stopped</em> if the resource had moved, and it
 * had. The caller's recovery differs: re-read and re-apply, rather than reconsider.
 */
public class PreconditionFailedException extends ApiException {

    public PreconditionFailedException(String message) {
        super(ErrorCodes.PRECONDITION_FAILED, 412, message);
    }
}
