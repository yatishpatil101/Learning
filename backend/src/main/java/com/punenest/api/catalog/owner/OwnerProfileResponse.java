package com.punenest.api.catalog.owner;

/**
 * The public seller card: everything a stranger is told about the person behind a listing.
 *
 * <p><strong>This record is a ceiling, not a projection of convenience.</strong> The profile page
 * used to be handed the entire user row — {@code getOwner()} spread the whole record, email,
 * role, account status and all — and rendered five fields out of it. Nothing was displayed that
 * should not have been, but everything was <em>sent</em>, and a page that receives a field will
 * eventually show it. The list here is short because it was chosen rather than inherited.
 *
 * <p>It matches, field for field, the owner block already embedded in a listing detail
 * ({@code PropertyResponse.Owner}) plus the two things a profile page says that a listing does not:
 * where they operate, and how long they have been here. That correspondence is deliberate. Those
 * four fields are the platform's only existing statement about what is safe to tell an anonymous
 * caller about a person, and inventing a second, wider answer on a route nobody is watching is
 * exactly how the first one stops being true.
 *
 * <p><strong>What is deliberately absent.</strong> Email, role, account status, the flag and
 * suspension state, {@code lastActive}, and the raw mobile. The first five are operational facts
 * about an account and belong to the staff directory; {@code lastActive} would turn a public page
 * into a presence indicator for a private individual, which nobody consented to. The mobile is
 * masked here and only here — the profile has no listing in context, so it has no contact gate to
 * ask, and a visitor who wants the number is sent to a listing where the grant they are given is
 * the grant they are actually shown.
 *
 * @param id          owner user id, the same id the listing card carries
 * @param name        display name
 * @param mobile      masked mobile ({@code 98XXXXX210}) — never the raw number on this route
 * @param verified    the identity "Verified" badge
 * @param city        where they operate; already public on every one of their listings
 * @param memberSince the <em>year</em> they joined, or {@code null} if unrecorded. A year, not the
 *     timestamp, because a year is what the page shows: "member since 2024" is social proof, while
 *     the exact minute of signup is a correlation handle that buys the reader nothing
 * @param listingCount how many approved, unarchived listings they have live right now — counted, not
 *     read from {@code users.listings_count}, which counts every row including the rejected and
 *     archived ones and so has always meant something different from the number beside it
 */
public record OwnerProfileResponse(
        String id,
        String name,
        String mobile,
        boolean verified,
        String city,
        Integer memberSince,
        long listingCount) {
}
