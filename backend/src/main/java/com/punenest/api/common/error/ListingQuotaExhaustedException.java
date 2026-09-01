package com.punenest.api.common.error;

/**
 * 422 — the caller already holds every live listing their plan and referrals allow.
 *
 * <p><strong>This gate did not exist until now, and the client's did not work.</strong> The wizard's
 * paywall compared a count of the listings <em>that browser's</em> {@code localStorage} happened to
 * hold against a ceiling the same browser computed. An owner who posted from a laptop and opened the
 * wizard on a phone had a used-count of zero and was waved straight past their limit; the free tier
 * was, in practice, a paywall against clearing your cookies. The browser now reads both numbers from
 * the server, but a number a client reads is still a number a client can ignore, which is what this
 * is for.
 *
 * <p><strong>422 rather than 403, as with {@link ContactQuotaExhaustedException}.</strong> A 403
 * makes clients offer a sign-in to a user who is already correctly signed in. Not 429 either: 429
 * promises that waiting works, and nothing here expires.
 *
 * <p><strong>Counted against live listings, not posts ever made.</strong> Taking a listing down
 * returns the slot — the free tier is one listing at a time, not one listing ever. That is also why
 * this can be a plain count rather than a stored tally: the catalogue already knows.
 */
public class ListingQuotaExhaustedException extends ApiException {

    public ListingQuotaExhaustedException(String message) {
        super(ErrorCodes.LISTING_QUOTA_EXHAUSTED, 422, message);
    }
}
