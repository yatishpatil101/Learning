package com.punenest.api.common.error;

/**
 * 422 — the caller has not earned the right to review this listing.
 *
 * <p>PuneNest's reviews are only worth reading if the people writing them actually turned up. The
 * React client has enforced that since day one ({@code ReviewsSection.jsx}: a completed visit or a
 * tenancy), but it enforced it <em>in the browser</em>, which means it did not enforce it at all —
 * anyone willing to call the API directly could seed a listing with praise or bury a rival's.
 * Moving the rule here is the whole point of owning reviews server-side.
 *
 * <p>422 rather than 403 deliberately. A 403 says "you are not allowed", which invites the client to
 * offer an upgrade or a login. Nothing the caller can be granted fixes this one: the only way to
 * become eligible is to go and see the flat. It is a statement about the request's premise, not
 * about the caller's permissions, and the client should render it as an explanation rather than a
 * prompt.
 */
public class ReviewNotEligibleException extends ApiException {

    public ReviewNotEligibleException(String message) {
        super(ErrorCodes.REVIEW_NOT_ELIGIBLE, 422, message);
    }
}
