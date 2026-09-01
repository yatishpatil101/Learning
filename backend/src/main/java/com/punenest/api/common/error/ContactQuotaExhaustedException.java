package com.punenest.api.common.error;

/**
 * 422 — the caller has opened every owner contact their plan and referrals allow (D31b).
 *
 * <p>The quota this refuses used to be a number in {@code localStorage}, counted by the browser
 * under a key derived from the user's own mobile number, in a module whose own header said it was
 * not real security. Clearing site data reset it; a second browser never saw it. Moving it here is
 * the point of the change, and this exception is the moment the rule became one.
 *
 * <p><strong>422 rather than 403, for the same reason as
 * {@link ReviewNotEligibleException}.</strong> A 403 says "you are not allowed", and every client on
 * this platform answers that by offering to sign in as somebody who is — which would be a login
 * prompt shown to a user who is already correctly signed in, and would not help them if they
 * complied. Not 429 either: that code promises the request will work if you wait, and the contact
 * quota is a lifetime total rather than a window, so waiting is exactly what does not work. What
 * fixes it is subscribing or referring, and the message says so.
 *
 * <p><strong>Nothing already opened is refused.</strong> The check runs only on the branch that
 * would insert a new {@code contact_requests} row, so a caller re-opening a conversation they
 * already started still gets their status back after the quota is spent. Being out of contacts means
 * you cannot approach a <em>new</em> owner; it does not mean the owners you already approached
 * disappear.
 */
public class ContactQuotaExhaustedException extends ApiException {

    public ContactQuotaExhaustedException(String message) {
        super(ErrorCodes.CONTACT_QUOTA_EXHAUSTED, 422, message);
    }
}
