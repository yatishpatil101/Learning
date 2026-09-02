package com.draazy.api.catalog.listing;

/**
 * The answer to {@link ListingDuplicateCheck}: does the caller already have this unit listed?
 *
 * <p>{@code existingId} names a listing the caller owns, so returning it discloses nothing they
 * cannot already read from {@code GET /me/listings}. That is the whole reason this route can answer
 * at all where {@code ListingDuplicateProbe} deliberately cannot: a finding about <em>somebody
 * else's</em> listing would turn a guessed meter number into a lookup, and a finding about your own
 * is just your own dashboard, reached by a different question.
 *
 * <p><strong>The id and nothing else.</strong> No slug: {@link com.draazy.api.catalog.property.Property#getSlug()}
 * is nullable and is not minted on create, so for the listings this route actually returns — ones
 * the caller posted themselves — it would be null every time, and a field that is always null reads
 * as a capability the server does not have. No title either: the caller is looking at the form they
 * just filled in, so they know what property this is about. Every id here resolves through
 * {@code GET /me/listings/{id}}, which is what the "open the one you already have" link needs.
 *
 * <p>When {@code found} is false {@code existingId} is null. There is no "maybe" — the caller uses
 * this to decide whether to stop a submission, and a third state would have to be resolved into one
 * of these two by the client, which is where the browser-side guess used to live.
 */
public record ListingDuplicateVerdict(boolean found, String existingId) {

    static final ListingDuplicateVerdict NONE = new ListingDuplicateVerdict(false, null);
}
