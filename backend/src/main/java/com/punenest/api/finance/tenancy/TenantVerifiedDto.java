package com.punenest.api.finance.tenancy;

/**
 * One answer in the {@code POST /tenant-profiles/verified} batch (contract {@code TenantVerified}).
 *
 * <p><strong>This carries a flag and nothing else, on purpose.</strong> The single-profile read
 * returns name, occupation, income and score to a caller who has a relationship with that tenant.
 * This one is asked about a whole list at once, so every extra field would be a whole list's worth
 * of somebody's income crossing the wire to render a tick. A badge needs one bit; it gets one bit.
 * There is no reason field either — "why not verified" is the difference between "no such person",
 * "not verified" and "not your business", and publishing that difference is precisely the
 * enumeration answer spec fix S10 refuses to give.
 *
 * <p><strong>{@link #mobile} is the caller's own input, echoed verbatim.</strong> Not the
 * normalised form, not the stored number, not a mask — the exact string that arrived in the
 * request, so the client can key its map on what it sent. That is also the guarantee that matters
 * for the standing rule that an owner's raw mobile is never revealed to a buyer pre-deal (D5/Q2):
 * this endpoint provably cannot emit a number the caller did not already hold, because the only
 * numbers it emits are the ones it was handed.
 *
 * @param mobile   the number as supplied by the caller, unchanged
 * @param verified whether that person is a verified tenant <em>as far as this caller may know</em>
 */
public record TenantVerifiedDto(String mobile, boolean verified) {
}
